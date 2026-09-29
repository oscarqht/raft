mod server;
mod tray;
mod updater;

use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

pub struct ServerUrlState(pub Mutex<Option<String>>);

pub fn is_dev() -> bool {
    if let Ok(val) = std::env::var("RAFT_ENV") {
        let v = val.trim().to_lowercase();
        if v == "production" || v == "prod" {
            return false;
        }
        if v == "development" || v == "dev" {
            return true;
        }
    }
    if let Ok(val) = std::env::var("NODE_ENV") {
        let v = val.trim().to_lowercase();
        if v == "production" || v == "prod" {
            return false;
        }
        if v == "development" || v == "dev" {
            return true;
        }
    }
    cfg!(debug_assertions) || std::env::var("RAFT_DEV").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false)
}

pub fn run() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        server::stop_server();
        default_hook(info);
    }));

    let builder = tauri::Builder::default()
        .manage(updater::init_state())
        .manage(ServerUrlState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            updater::check_for_updates_manual,
            updater::get_update_status,
            updater::install_and_relaunch,
            updater::close_update_window,
            tray::cmd_check_full_disk_access,
            tray::cmd_open_full_disk_access_settings,
        ])
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(state) = app.try_state::<ServerUrlState>() {
                if let Ok(guard) = state.0.lock() {
                    if let Some(url) = guard.as_ref() {
                        let _ = open::that(url);
                    }
                }
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    let app = builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            let app_handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                match server::start_server(app_handle.clone()).await {
                    Ok((server_url, port, internal_token)) => {
                        println!("[raft] Server running at {server_url}");

                        // Store server URL in app state for single-instance focus
                        if let Some(state) = app_handle.try_state::<ServerUrlState>() {
                            if let Ok(mut guard) = state.0.lock() {
                                *guard = Some(server_url.clone());
                            }
                        }

                        if let Err(e) = tray::setup_tray(&app_handle, server_url.clone()) {
                            eprintln!("[raft] Failed to setup tray: {e}");
                        }
                        updater::start_background_updater(app_handle.clone());

                        // Periodically sync UpdateStatus with the Express server and poll for user-triggered updater actions
                        let sync_app_handle = app_handle.clone();
                        let sync_token = internal_token.clone();
                        tauri::async_runtime::spawn(async move {
                            let client = reqwest::Client::builder()
                                .timeout(std::time::Duration::from_secs(2))
                                .build()
                                .unwrap_or_default();

                            let mut interval = tokio::time::interval(std::time::Duration::from_millis(1500));
                            let mut last_status: Option<updater::UpdateStatus> = None;

                            loop {
                                interval.tick().await;

                                // 1. Push latest UpdateStatus to server if changed
                                if let Some(state) = sync_app_handle.try_state::<updater::UpdateState>() {
                                    let current_status = {
                                        let mgr = state.0.lock().await;
                                        mgr.status.clone()
                                    };

                                    if last_status.as_ref() != Some(&current_status) {
                                        last_status = Some(current_status.clone());
                                        let url = format!("http://127.0.0.1:{}/api/internal/updater-status", port);
                                        let _ = client
                                            .post(&url)
                                            .header("X-Raft-Token", &sync_token)
                                            .json(&current_status)
                                            .send()
                                            .await;
                                    }
                                }

                                // 2. Check if web client triggered updater action
                                let action_url = format!("http://127.0.0.1:{}/api/internal/updater-action", port);
                                if let Ok(resp) = client
                                    .get(&action_url)
                                    .header("X-Raft-Token", &sync_token)
                                    .send()
                                    .await
                                {
                                    if let Ok(val) = resp.json::<serde_json::Value>().await {
                                        if let Some(act) = val.get("action").and_then(|v| v.as_str()) {
                                            match act {
                                                "check" => {
                                                    let h = sync_app_handle.clone();
                                                    tauri::async_runtime::spawn(async move {
                                                        updater::check_and_download(&h, false, true).await;
                                                    });
                                                }
                                                "install" => {
                                                    let h = sync_app_handle.clone();
                                                    tauri::async_runtime::spawn(async move {
                                                        let _ = updater::install_and_relaunch_inner(&h).await;
                                                    });
                                                }
                                                _ => {}
                                            }
                                        }
                                    }
                                }
                            }
                        });

                        // Automatically open browser on initial interactive launch (using localhost for secure context)
                        let is_autostart = std::env::args().any(|a| a == "--autostart" || a == "--silent");
                        if !is_autostart {
                            let local_url = format!("http://localhost:{port}");
                            let _ = open::that(&local_url);
                        }

                        #[cfg(target_os = "macos")]
                        {
                            use tauri_plugin_notification::NotificationExt;
                            if !tray::check_full_disk_access() {
                                println!("[raft] Full Disk Access is not granted yet. Notifying user...");
                                let _ = app_handle
                                    .notification()
                                    .builder()
                                    .title("Raft Permissions")
                                    .body("Raft needs Full Disk Access to avoid folder permission prompts when inspecting repositories. Click the status bar icon to configure.")
                                    .show();
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[raft] Failed to start server: {e}");
                        let _ = app_handle
                            .dialog()
                            .message(format!("Failed to start Raft server:\n\n{e}"))
                            .title("Raft Error")
                            .kind(MessageDialogKind::Error)
                            .blocking_show();
                        app_handle.exit(1);
                    }
                }
            });

            #[cfg(unix)]
            {
                tauri::async_runtime::spawn(async {
                    use tokio::signal::unix::{signal, SignalKind};
                    let mut sigterm = signal(SignalKind::terminate()).ok();
                    let mut sigquit = signal(SignalKind::quit()).ok();
                    let mut sighup = signal(SignalKind::hangup()).ok();

                    tokio::select! {
                        _ = tokio::signal::ctrl_c() => {
                            println!("[raft] Received SIGINT, stopping server...");
                        }
                        _ = async {
                            if let Some(s) = sigterm.as_mut() {
                                s.recv().await;
                            } else {
                                std::future::pending::<()>().await;
                            }
                        } => {
                            println!("[raft] Received SIGTERM, stopping server...");
                        }
                        _ = async {
                            if let Some(s) = sigquit.as_mut() {
                                s.recv().await;
                            } else {
                                std::future::pending::<()>().await;
                            }
                        } => {
                            println!("[raft] Received SIGQUIT, stopping server...");
                        }
                        _ = async {
                            if let Some(s) = sighup.as_mut() {
                                s.recv().await;
                            } else {
                                std::future::pending::<()>().await;
                            }
                        } => {
                            println!("[raft] Received SIGHUP, stopping server...");
                        }
                    }

                    server::stop_server();
                    std::process::exit(0);
                });
            }

            #[cfg(windows)]
            {
                tauri::async_runtime::spawn(async {
                    let mut ctrl_c = tokio::signal::windows::ctrl_c().ok();
                    let mut ctrl_break = tokio::signal::windows::ctrl_break().ok();
                    let mut ctrl_close = tokio::signal::windows::ctrl_close().ok();
                    let mut ctrl_shutdown = tokio::signal::windows::ctrl_shutdown().ok();

                    tokio::select! {
                        _ = async {
                            if let Some(s) = ctrl_c.as_mut() {
                                s.recv().await;
                            } else {
                                std::future::pending::<()>().await;
                            }
                        } => {}
                        _ = async {
                            if let Some(s) = ctrl_break.as_mut() {
                                s.recv().await;
                            } else {
                                std::future::pending::<()>().await;
                            }
                        } => {}
                        _ = async {
                            if let Some(s) = ctrl_close.as_mut() {
                                s.recv().await;
                            } else {
                                std::future::pending::<()>().await;
                            }
                        } => {}
                        _ = async {
                            if let Some(s) = ctrl_shutdown.as_mut() {
                                s.recv().await;
                            } else {
                                std::future::pending::<()>().await;
                            }
                        } => {}
                    }

                    server::stop_server();
                    std::process::exit(0);
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        match event {
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                let handle = _app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(state) = handle.try_state::<ServerUrlState>() {
                        if let Ok(guard) = state.0.lock() {
                            if let Some(url) = guard.as_ref() {
                                let _ = open::that(url);
                            }
                        }
                    }
                    updater::handle_app_reopen(&handle).await;
                });
            }
            RunEvent::ExitRequested { code, api, .. } => {
                if code.is_none() {
                    // Keep app running in menu bar / status bar when windows close
                    api.prevent_exit();
                } else {
                    server::stop_server();
                }
            }
            RunEvent::Exit => {
                server::stop_server();
            }
            _ => {}
        }
    });
}
