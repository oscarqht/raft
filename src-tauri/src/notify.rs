use tauri::AppHandle;

#[cfg(target_os = "macos")]
fn get_icon_path(app: &AppHandle) -> Option<String> {
    use tauri::Manager;

    // 1. If running as a macOS .app bundle, icon.icns is in Contents/Resources
    if let Ok(curr_exe) = std::env::current_exe() {
        if let Some(bundle) = curr_exe
            .ancestors()
            .find(|p| p.extension().map_or(false, |e| e == "app"))
        {
            let icns = bundle.join("Contents").join("Resources").join("icon.icns");
            if icns.exists() {
                return Some(icns.to_string_lossy().to_string());
            }
        }
    }

    // 2. Installed /Applications/Alpha Bro.app
    let installed_app_icon =
        std::path::Path::new("/Applications/Alpha Bro.app/Contents/Resources/icon.icns");
    if installed_app_icon.exists() {
        return Some(installed_app_icon.to_string_lossy().to_string());
    }

    // 3. Bundled resource directory or source icons
    if let Ok(res_dir) = app.path().resource_dir() {
        let icns = res_dir.join("icons").join("icon.icns");
        if icns.exists() {
            return Some(icns.to_string_lossy().to_string());
        }
        let png = res_dir.join("icons").join("icon.png");
        if png.exists() {
            return Some(png.to_string_lossy().to_string());
        }
    }

    // 4. Fallback relative to current working directory (e.g. dev mode)
    let dev_icon = std::path::Path::new("icons/icon.png");
    if dev_icon.exists() {
        if let Ok(abs) = std::fs::canonicalize(dev_icon) {
            return Some(abs.to_string_lossy().to_string());
        }
    }

    let dev_icon_src = std::path::Path::new("src-tauri/icons/icon.png");
    if dev_icon_src.exists() {
        if let Ok(abs) = std::fs::canonicalize(dev_icon_src) {
            return Some(abs.to_string_lossy().to_string());
        }
    }

    None
}

/// Dispatches a system notification with the Alpha Bro branding / icon.
pub fn show_notification(app: &AppHandle, title: &str, body: &str) {
    #[cfg(target_os = "macos")]
    {
        let icon_path = get_icon_path(app);
        let mut notif = mac_notification_sys::Notification::new();
        notif.title(title);
        notif.message(body);
        if let Some(ref path) = icon_path {
            notif.app_icon(path);
        }
        if !crate::is_dev() {
            let _ = mac_notification_sys::set_application(&app.config().identifier);
        }
        if notif.send().is_ok() {
            return;
        }
    }

    // Default / fallback via tauri_plugin_notification
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .icon("icons/128x128.png")
        .show();
}

#[cfg(test)]
mod tests {

    #[test]
    fn test_app_icon_exists() {
        // Ensure at least one Alpha Bro icon asset exists in the repository
        let icon_paths = [
            "icons/icon.icns",
            "icons/icon.png",
            "../assets/icon.png",
            "src-tauri/icons/icon.png",
            "src-tauri/icons/icon.icns",
        ];
        let found = icon_paths.iter().any(|p| std::path::Path::new(p).exists());
        assert!(found, "At least one valid Alpha Bro icon file should exist");
    }

    #[test]
    fn test_tauri_identifier() {
        let conf_str = std::fs::read_to_string("tauri.conf.json")
            .or_else(|_| std::fs::read_to_string("src-tauri/tauri.conf.json"))
            .expect("tauri.conf.json must exist");
        let conf: serde_json::Value = serde_json::from_str(&conf_str).expect("Valid JSON");
        assert_eq!(
            conf["identifier"].as_str(),
            Some("com.oscarqht.alphabro"),
            "Bundle identifier must be com.oscarqht.alphabro to avoid macOS Notification Center legacy cache"
        );
        assert_eq!(
            conf["productName"].as_str(),
            Some("Alpha Bro"),
            "productName must be Alpha Bro"
        );
    }
}
