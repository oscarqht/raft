use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

#[cfg(target_os = "macos")]
use tauri::{Manager, Wry};

#[cfg(target_os = "macos")]
use std::sync::Mutex;

#[cfg(target_os = "macos")]
pub struct TrayFdaState {
    pub item: Mutex<Option<CheckMenuItem<Wry>>>,
}

#[cfg(target_os = "macos")]
pub fn update_fda_menu_item(app: &AppHandle) {
    if let Some(state) = app.try_state::<TrayFdaState>() {
        let granted = check_full_disk_access();
        if let Ok(guard) = state.item.lock() {
            if let Some(item) = guard.as_ref() {
                let _ = item.set_checked(granted);
                let _ = item.set_text(if granted {
                    "Full Disk Access Enabled"
                } else {
                    "Grant Full Disk Access..."
                });
            }
        }
    }
}

fn copy_to_clipboard(text: &str) {
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        if let Ok(mut child) = std::process::Command::new("pbcopy")
            .stdin(std::process::Stdio::piped())
            .spawn()
        {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(text.as_bytes());
            }
            let _ = child.wait();
        }
    }
    #[cfg(target_os = "windows")]
    {
        let ps_cmd = format!("Set-Clipboard -Value '{}'", text);
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_cmd])
            .spawn();
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        use std::io::Write;
        if let Ok(mut child) = std::process::Command::new("xclip")
            .args(["-selection", "clipboard"])
            .stdin(std::process::Stdio::piped())
            .spawn()
        {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(text.as_bytes());
            }
            let _ = child.wait();
        }
    }
}

pub fn check_full_disk_access() -> bool {
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let safari_path = std::path::Path::new(&home).join("Library/Safari");
            if std::fs::read_dir(safari_path).is_ok() {
                return true;
            }
        }
        std::fs::read_dir("/Library/Application Support/com.apple.TCC").is_ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[tauri::command]
pub fn cmd_check_full_disk_access() -> bool {
    check_full_disk_access()
}

pub fn open_full_disk_access_settings() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
            .spawn();

        if let Ok(current_exe) = std::env::current_exe() {
            if let Some(app_bundle) = current_exe
                .ancestors()
                .find(|p| p.extension().map_or(false, |e| e == "app"))
            {
                let _ = std::process::Command::new("open")
                    .args(["-R", &app_bundle.to_string_lossy()])
                    .spawn();
            } else if std::path::Path::new("/Applications/Raft.app").exists() {
                let _ = std::process::Command::new("open")
                    .args(["-R", "/Applications/Raft.app"])
                    .spawn();
            }
        }
    }
}

#[tauri::command]
pub fn cmd_open_full_disk_access_settings() {
    open_full_disk_access_settings();
}

pub fn setup_tray(
    app: &AppHandle,
    server_url: String,
) -> Result<(), Box<dyn std::error::Error>> {
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);

    let host_part = server_url
        .strip_prefix("http://")
        .or_else(|| server_url.strip_prefix("https://"))
        .unwrap_or(&server_url)
        .split(':')
        .next()
        .unwrap_or("");
    let is_tailscale = crate::server::is_tailscale_ip_str(host_part);
    let copy_label = if is_tailscale {
        "Copy Tailscale URL"
    } else {
        "Copy Local URL"
    };

    let open_item = MenuItem::with_id(app, "open_browser", "Open Raft in Browser", true, None::<&str>)?;
    let copy_item = MenuItem::with_id(app, "copy_url", copy_label, true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;

    #[cfg(target_os = "macos")]
    let fda_granted = check_full_disk_access();
    #[cfg(target_os = "macos")]
    let fda_text = if fda_granted {
        "Full Disk Access Enabled"
    } else {
        "Grant Full Disk Access..."
    };
    #[cfg(target_os = "macos")]
    let fda_item = CheckMenuItem::with_id(
        app,
        "full_disk_access",
        fda_text,
        true,
        fda_granted,
        None::<&str>,
    )?;
    #[cfg(target_os = "macos")]
    {
        app.manage(TrayFdaState {
            item: Mutex::new(Some(fda_item.clone())),
        });

        let app_handle_poll = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(3));
            loop {
                interval.tick().await;
                update_fda_menu_item(&app_handle_poll);
            }
        });
    }

    let autostart_item = CheckMenuItem::with_id(
        app,
        "toggle_autostart",
        "Launch at Login",
        true,
        autostart_enabled,
        None::<&str>,
    )?;
    let check_updates_item = MenuItem::with_id(
        app,
        "check_updates",
        "Check for Updates...",
        true,
        None::<&str>,
    )?;
    crate::updater::register_tray_item(app, check_updates_item.clone());
    let version_text = format!("Version {}", app.package_info().version);
    let version_item = MenuItem::with_id(
        app,
        "version",
        &version_text,
        false,
        None::<&str>,
    )?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Raft", true, None::<&str>)?;

    #[cfg(target_os = "macos")]
    let menu = Menu::with_items(
        app,
        &[
            &open_item,
            &copy_item,
            &sep1,
            &fda_item,
            &autostart_item,
            &check_updates_item,
            &version_item,
            &sep2,
            &quit_item,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(
        app,
        &[
            &open_item,
            &copy_item,
            &sep1,
            &autostart_item,
            &check_updates_item,
            &version_item,
            &sep2,
            &quit_item,
        ],
    )?;

    let port_part = server_url
        .rsplit(':')
        .next()
        .and_then(|p| p.split('/').next())
        .unwrap_or("3300");
    let local_url = format!("http://localhost:{port_part}");
    let url_for_browser = if is_tailscale { local_url } else { server_url.clone() };

    let url_for_browser_click = url_for_browser.clone();
    let url_for_browser_menu = url_for_browser;
    let url_for_copy = server_url.clone();
    let autostart_item_clone = autostart_item.clone();

    let icon_image = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
        .unwrap_or_else(|_| app.default_window_icon().cloned().unwrap());

    #[allow(unused_mut)]
    let mut tray_builder = TrayIconBuilder::new()
        .icon(icon_image)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Raft — AI Coding Workspace");

    #[cfg(target_os = "macos")]
    {
        tray_builder = tray_builder.icon_as_template(true);
    }

    tray_builder
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = open::that(&url_for_browser_click);
            }
        })
        .on_menu_event(move |app_handle, event| {
            let id = event.id.as_ref();
            match id {
                "open_browser" => {
                    let _ = open::that(&url_for_browser_menu);
                }
                "copy_url" => {
                    copy_to_clipboard(&url_for_copy);
                }
                "full_disk_access" => {
                    #[cfg(target_os = "macos")]
                    if !check_full_disk_access() {
                        open_full_disk_access_settings();
                    }
                }
                "toggle_autostart" => {
                    let autolaunch = app_handle.autolaunch();
                    if let Ok(enabled) = autolaunch.is_enabled() {
                        if enabled {
                            let _ = autolaunch.disable();
                            let _ = autostart_item_clone.set_checked(false);
                        } else {
                            let _ = autolaunch.enable();
                            let _ = autostart_item_clone.set_checked(true);
                        }
                    }
                }
                "check_updates" => {
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        crate::updater::handle_check_updates_click(&handle).await;
                    });
                }
                "quit" => {
                    crate::server::stop_server();
                    app_handle.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
