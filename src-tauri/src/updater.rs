use std::sync::Arc;
use std::time::Duration;
use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Wry};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(tag = "status", content = "data")]
pub enum UpdateStatus {
    Idle,
    Checking,
    UpToDate {
        current_version: String,
    },
    Downloading {
        version: String,
        current_version: String,
        body: Option<String>,
        downloaded: u64,
        total: Option<u64>,
        percent: u32,
    },
    Downloaded {
        version: String,
        current_version: String,
        body: Option<String>,
    },
    Error {
        message: String,
    },
}

pub struct UpdateManager {
    pub status: UpdateStatus,
    pub pending_update: Option<Update>,
    pub downloaded_bytes: Option<Vec<u8>>,
    pub tray_item: Option<MenuItem<Wry>>,
    pub is_checking_or_downloading: bool,
}

impl Default for UpdateManager {
    fn default() -> Self {
        Self {
            status: UpdateStatus::Idle,
            pending_update: None,
            downloaded_bytes: None,
            tray_item: None,
            is_checking_or_downloading: false,
        }
    }
}

pub struct UpdateState(pub Arc<Mutex<UpdateManager>>);

pub fn init_state() -> UpdateState {
    UpdateState(Arc::new(Mutex::new(UpdateManager::default())))
}

pub fn register_tray_item(app: &AppHandle, item: MenuItem<Wry>) {
    let state = app.state::<UpdateState>();
    let state_arc = state.0.clone();
    tauri::async_runtime::spawn(async move {
        let mut mgr = state_arc.lock().await;
        mgr.tray_item = Some(item);
    });
}

pub fn open_or_focus_updater_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("updater") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let state_arc = app.state::<UpdateState>().0.clone();
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let mgr = state_arc.lock().await;
            let _ = handle.emit("raft://update-status", &mgr.status);
        });
        return Ok(());
    }

    let url = WebviewUrl::App("updater.html".into());
    let window = WebviewWindowBuilder::new(app, "updater", url)
        .title("Alpha Bro Software Update")
        .inner_size(440.0, 420.0)
        .resizable(false)
        .center()
        .always_on_top(true)
        .build()?;

    let _ = window.set_focus();
    Ok(())
}

pub fn close_update_window_inner(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("updater") {
        let _ = window.close();
    }
}

pub async fn check_and_download(app: &AppHandle, show_window: bool, force: bool) {
    if show_window {
        let _ = open_or_focus_updater_window(app);
    }

    let state = app.state::<UpdateState>();
    {
        let mgr = state.0.lock().await;
        if !force && matches!(mgr.status, UpdateStatus::Downloaded { .. }) {
            let _ = app.emit("raft://update-status", &mgr.status);
            return;
        }
        if mgr.is_checking_or_downloading {
            let _ = app.emit("raft://update-status", &mgr.status);
            return;
        }
    }

    {
        let mut mgr = state.0.lock().await;
        mgr.is_checking_or_downloading = true;
        mgr.status = UpdateStatus::Checking;
    }
    let _ = app.emit("raft://update-status", UpdateStatus::Checking);

    if crate::is_dev() {
        println!("[raft] Development mode active: updater is disabled.");
        let status = UpdateStatus::UpToDate {
            current_version: app.package_info().version.to_string(),
        };
        let mut mgr = state.0.lock().await;
        mgr.status = status.clone();
        mgr.is_checking_or_downloading = false;
        let _ = app.emit("raft://update-status", &status);
        return;
    }

    let updater = match get_updater(app) {
        Ok(u) => u,
        Err(e) => {
            let err_msg = format!("Failed to initialize updater: {e}");
            eprintln!("[raft] {err_msg}");
            let err_status = UpdateStatus::Error { message: err_msg };
            let mut mgr = state.0.lock().await;
            mgr.status = err_status.clone();
            mgr.is_checking_or_downloading = false;
            let _ = app.emit("raft://update-status", &err_status);
            return;
        }
    };

    println!("[raft] Checking for updates...");
    match updater.check().await {
        Ok(Some(update)) => {
            println!("[raft] New version available: v{}", update.version);
            let version = update.version.clone();
            let current_version = update.current_version.clone();
            let body = update.body.clone();

            let initial_status = UpdateStatus::Downloading {
                version: version.clone(),
                current_version: current_version.clone(),
                body: body.clone(),
                downloaded: 0,
                total: None,
                percent: 0,
            };
            {
                let mut mgr = state.0.lock().await;
                mgr.status = initial_status.clone();
            }
            let _ = app.emit("raft://update-status", &initial_status);

            let mut downloaded = 0u64;
            let mut last_emit = std::time::Instant::now();
            let mut last_pct = 0u32;
            let app_clone = app.clone();
            let version_for_cb = version.clone();
            let curr_for_cb = current_version.clone();
            let body_for_cb = body.clone();
            let state_arc = state.0.clone();

            let res = update
                .download(
                    move |chunk_length, content_length| {
                        downloaded += chunk_length as u64;
                        let pct = if let Some(tot) = content_length {
                            if tot > 0 {
                                ((downloaded as f64 / tot as f64) * 100.0) as u32
                            } else {
                                0
                            }
                        } else {
                            0
                        };

                        let elapsed = last_emit.elapsed();
                        if pct < 100
                            && (pct != last_pct || elapsed >= Duration::from_millis(250))
                        {
                            last_pct = pct;
                            last_emit = std::time::Instant::now();
                            let status = UpdateStatus::Downloading {
                                version: version_for_cb.clone(),
                                current_version: curr_for_cb.clone(),
                                body: body_for_cb.clone(),
                                downloaded,
                                total: content_length,
                                percent: pct,
                            };
                            if let Ok(mut mgr) = state_arc.try_lock() {
                                if !matches!(mgr.status, UpdateStatus::Downloaded { .. }) {
                                    mgr.status = status.clone();
                                }
                            }
                            let _ = app_clone.emit("raft://update-status", &status);
                        }
                    },
                    || {
                        println!("[raft] Auto-updater download complete.");
                    },
                )
                .await;

            match res {
                Ok(bytes) => {
                    println!("[raft] Downloaded {} bytes successfully", bytes.len());
                    let new_status = UpdateStatus::Downloaded {
                        version: version.clone(),
                        current_version: current_version.clone(),
                        body: body.clone(),
                    };

                    {
                        let mut mgr = state.0.lock().await;
                        mgr.pending_update = Some(update);
                        mgr.downloaded_bytes = Some(bytes);
                        mgr.status = new_status.clone();
                        if let Some(tray_item) = &mgr.tray_item {
                            let _ = tray_item.set_text(format!("Restart to Update to v{version}"));
                        }
                    }

                    let _ = app.emit("raft://update-status", &new_status);

                    let notif_body = format!(
                        "Version v{} is downloaded. Click here or open the status bar menu to restart.",
                        version
                    );
                    crate::notify::show_notification(
                        &app,
                        "Alpha Bro Update Ready",
                        &notif_body,
                    );
                }
                Err(e) => {
                    eprintln!("[raft] Update download failed: {e}");
                    let err_status = UpdateStatus::Error {
                        message: format!("Download failed: {e}"),
                    };
                    let mut mgr = state.0.lock().await;
                    mgr.status = err_status.clone();
                    let _ = app.emit("raft://update-status", &err_status);
                }
            }
        }
        Ok(None) => {
            println!("[raft] Raft is up to date.");
            let status = UpdateStatus::UpToDate {
                current_version: app.package_info().version.to_string(),
            };
            let mut mgr = state.0.lock().await;
            mgr.pending_update = None;
            mgr.downloaded_bytes = None;
            mgr.status = status.clone();
            if let Some(tray_item) = &mgr.tray_item {
                let _ = tray_item.set_text("Check for Updates...");
            }
            let _ = app.emit("raft://update-status", &status);
        }
        Err(e) => {
            eprintln!("[raft] Update check error: {e}");
            let err_status = UpdateStatus::Error {
                message: format!("Check failed: {e}"),
            };
            let mut mgr = state.0.lock().await;
            mgr.status = err_status.clone();
            let _ = app.emit("raft://update-status", &err_status);
        }
    }

    let mut mgr = state.0.lock().await;
    mgr.is_checking_or_downloading = false;
}

pub async fn check_and_download_silent(app: &AppHandle) {
    check_and_download(app, false, false).await;
}

pub async fn check_and_download_manual(app: &AppHandle) {
    check_and_download(app, true, true).await;
}

pub async fn handle_check_updates_click(app: &AppHandle) {
    let is_downloaded = {
        let state = app.state::<UpdateState>();
        let mgr = state.0.lock().await;
        matches!(mgr.status, UpdateStatus::Downloaded { .. })
    };

    if is_downloaded {
        let _ = open_or_focus_updater_window(app);
    } else {
        check_and_download_manual(app).await;
    }
}

pub async fn handle_app_reopen(app: &AppHandle) {
    let is_downloaded = {
        let state = app.state::<UpdateState>();
        let mgr = state.0.lock().await;
        matches!(mgr.status, UpdateStatus::Downloaded { .. })
    };

    if is_downloaded {
        let _ = open_or_focus_updater_window(app);
    }
}

pub async fn install_and_relaunch_inner(app: &AppHandle) -> Result<(), String> {
    let (pending_update, downloaded_bytes) = {
        let state = app.state::<UpdateState>();
        let mut mgr = state.0.lock().await;
        (mgr.pending_update.take(), mgr.downloaded_bytes.take())
    };

    if let (Some(update), Some(bytes)) = (pending_update, downloaded_bytes) {
        println!("[raft] Installing downloaded update package...");
        if let Err(e) = update.install(bytes) {
            let err_msg = format!("Failed to install update: {e}");
            eprintln!("[raft] {err_msg}");
            let state = app.state::<UpdateState>();
            let mut mgr = state.0.lock().await;
            mgr.status = UpdateStatus::Error {
                message: err_msg.clone(),
            };
            let _ = app.emit("raft://update-status", &mgr.status);
            return Err(err_msg);
        }
        println!("[raft] Update installed successfully! Relaunching app...");
    }

    crate::server::stop_server();

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1000)).await;
        #[cfg(target_os = "macos")]
        {
            if let Ok(curr_exe) = std::env::current_exe() {
                let is_bundle = curr_exe.to_string_lossy().contains(".app/Contents/MacOS");
                if is_bundle {
                    let bundle_exists = curr_exe
                        .parent()
                        .and_then(|p| p.parent())
                        .and_then(|p| p.parent())
                        .map(|b| b.exists())
                        .unwrap_or(false);
                    if !bundle_exists {
                        let installed_app = std::path::Path::new("/Applications/Alpha Bro.app");
                        let fallback_app = std::path::Path::new("/Applications/Raft.app");
                        let target = if installed_app.exists() {
                            installed_app
                        } else {
                            fallback_app
                        };
                        if target.exists() {
                            println!("[raft] Relaunching {}...", target.display());
                            let _ = std::process::Command::new("open")
                                .arg("-a")
                                .arg(target)
                                .spawn();
                            std::process::exit(0);
                        }
                    }
                }
            }
        }
        handle.restart();
    });
    Ok(())
}

fn get_updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let mut builder = app.updater_builder();
    #[cfg(target_os = "macos")]
    {
        if let Ok(curr_exe) = std::env::current_exe() {
            let is_bundle = curr_exe.to_string_lossy().contains(".app/Contents/MacOS");
            if is_bundle {
                let bundle_opt = curr_exe
                    .parent()
                    .and_then(|p| p.parent())
                    .and_then(|p| p.parent());
                let bundle_exists = bundle_opt.map(|b| b.exists()).unwrap_or(false);
                if !bundle_exists {
                    let installed_app = std::path::PathBuf::from("/Applications/Alpha Bro.app/Contents/MacOS/raft");
                    let fallback_app = std::path::PathBuf::from("/Applications/Raft.app/Contents/MacOS/raft");
                    let target = if installed_app.exists() {
                        installed_app
                    } else {
                        fallback_app
                    };
                    if target.exists() {
                        println!("[raft] Current running app bundle was deleted; targeting {} for update", target.display());
                        builder = builder.executable_path(target);
                    } else {
                        let path_str = bundle_opt.map(|b| b.display().to_string()).unwrap_or_default();
                        return Err(format!(
                            "Cannot update: Application bundle at '{path_str}' does not exist on disk. Please reinstall Alpha Bro into /Applications."
                        ));
                    }
                }
            }
        }
    }
    builder.build().map_err(|e| e.to_string())
}

pub fn start_background_updater(app: AppHandle) {
    if crate::is_dev() {
        println!("[raft] Development mode active: background updater disabled.");
        return;
    }
    tauri::async_runtime::spawn(async move {
        // Initial check 10 seconds after startup
        tokio::time::sleep(Duration::from_secs(10)).await;
        check_and_download_silent(&app).await;

        // Recurring check every 1 hour
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            check_and_download_silent(&app).await;
        }
    });
}

// Tauri IPC Commands
#[tauri::command]
pub async fn check_for_updates_manual(app: AppHandle) -> Result<(), String> {
    check_and_download_manual(&app).await;
    Ok(())
}

#[tauri::command]
pub async fn get_update_status(app: AppHandle) -> Result<UpdateStatus, String> {
    let state = app.state::<UpdateState>();
    let mgr = state.0.lock().await;
    Ok(mgr.status.clone())
}

#[tauri::command]
pub async fn install_and_relaunch(app: AppHandle) -> Result<(), String> {
    install_and_relaunch_inner(&app).await
}

#[tauri::command]
pub async fn close_update_window(app: AppHandle) -> Result<(), String> {
    close_update_window_inner(&app);
    Ok(())
}
