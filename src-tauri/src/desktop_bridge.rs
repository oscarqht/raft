use crate::{notify, updater};
use std::time::Duration;
use tauri::{AppHandle, Listener};

pub fn start(app: AppHandle, port: u16, token: String) {
    // Updater already emits state changes. Coalesce download progress without polling.
    let (status_tx, mut status_rx) =
        tokio::sync::watch::channel(serde_json::json!({"status": "Idle"}));
    app.listen("raft://update-status", move |event| {
        if let Ok(status) = serde_json::from_str(event.payload()) {
            status_tx.send_replace(status);
        }
    });
    let status_app = app.clone();
    let status_token = token.clone();
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        loop {
            let status = status_rx.borrow_and_update().clone();
            let sent = client.post(format!("http://127.0.0.1:{port}/api/internal/updater-status"))
                .header("X-Raft-Token", &status_token)
                .json(&serde_json::json!({ "current_version": status_app.package_info().version.to_string(), "status": status }))
                .send().await.map(|response| response.status().is_success()).unwrap_or(false);
            if !sent {
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
            if status_rx.changed().await.is_err() {
                break;
            }
        }
    });
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        loop {
            let request = client
                .get(format!("http://127.0.0.1:{port}/api/internal/events"))
                .header("X-Raft-Token", &token)
                .send();
            if let Ok(Ok(mut response)) =
                tokio::time::timeout(Duration::from_secs(10), request).await
            {
                if response.status().is_success() {
                    let mut pending = Vec::new();
                    loop {
                        // Detect broken streams; the server sends a heartbeat every 30 seconds.
                        let chunk =
                            tokio::time::timeout(Duration::from_secs(75), response.chunk()).await;
                        let Ok(Ok(Some(chunk))) = chunk else { break };
                        pending.extend_from_slice(&chunk);
                        while let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
                            let line: Vec<_> = pending.drain(..=end).collect();
                            if let Ok(event) = serde_json::from_slice::<serde_json::Value>(&line) {
                                handle_event(&app, &event);
                            }
                        }
                        if pending.len() > 1024 * 1024 {
                            break;
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    });
}

fn handle_event(app: &AppHandle, event: &serde_json::Value) {
    match event["type"].as_str() {
        Some("action") => {
            let handle = app.clone();
            match event["action"].as_str() {
                Some("check") => {
                    tauri::async_runtime::spawn(async move {
                        updater::check_and_download(&handle, false, true).await;
                    });
                }
                Some("install") => {
                    tauri::async_runtime::spawn(async move {
                        let _ = updater::install_and_relaunch_inner(&handle).await;
                    });
                }
                _ => {}
            }
        }
        Some("notification") => notify::show_notification(
            app,
            event["title"].as_str().unwrap_or("Alpha Bro"),
            event["body"].as_str().unwrap_or(""),
        ),
        _ => {}
    }
}
