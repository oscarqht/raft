use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LauncherStatus {
    pub node_installed: bool,
    pub node_version: Option<String>,
    pub node_path: Option<String>,
    pub git_installed: bool,
    pub git_version: Option<String>,
    pub git_path: Option<String>,
    pub platform: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstallProgress {
    pub target: String, // "node" or "git"
    pub stage: String,  // "idle" | "checking" | "downloading" | "extracting" | "verifying" | "done" | "error"
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: u32,
    pub message: String,
}

static INSTALL_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
static CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Get the base runtimes directory: <app_local_data_dir>/runtimes
pub fn get_runtimes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let local_data = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to get app local data dir: {e}"))?;
    let runtimes = local_data.join("runtimes");
    std::fs::create_dir_all(&runtimes)
        .map_err(|e| format!("Failed to create runtimes directory {:?}: {e}", runtimes))?;
    Ok(crate::server::clean_path(runtimes))
}

/// Helper to execute a command and capture trimmed stdout if successful
pub fn run_cmd_version(exe: &Path, arg: &str) -> Option<String> {
    let mut cmd = std::process::Command::new(exe);
    cmd.arg(arg);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    match cmd.output() {
        Ok(output) if output.status.success() => {
            let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !s.is_empty() {
                Some(s)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Look for app-managed Node.js runtime in <runtimes>/node
pub fn find_runtime_node(app: &AppHandle) -> Option<(PathBuf, String)> {
    let runtimes_dir = get_runtimes_dir(app).ok()?;
    let node_dir = runtimes_dir.join("node");
    if !node_dir.is_dir() {
        return None;
    }

    let exe_name = if cfg!(windows) { "node.exe" } else { "node" };

    let mut candidates = vec![
        node_dir.join(exe_name),
        node_dir.join("bin").join(exe_name),
    ];

    // Check direct subdirectories (in case unzipped with version folder)
    if let Ok(entries) = std::fs::read_dir(&node_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                candidates.push(entry.path().join(exe_name));
                candidates.push(entry.path().join("bin").join(exe_name));
            }
        }
    }

    for c in candidates {
        if c.is_file() {
            let clean = crate::server::clean_path(c);
            if let Some(ver) = run_cmd_version(&clean, "-v") {
                return Some((clean, ver));
            }
        }
    }
    None
}

/// Look for system-installed Node.js
pub fn check_system_node(app: &AppHandle) -> Option<(PathBuf, String)> {
    if let Some(bin) = crate::server::discover_node_binary(app) {
        let clean = crate::server::clean_path(bin);
        if let Some(ver) = run_cmd_version(&clean, "-v") {
            return Some((clean, ver));
        }
    }
    None
}

/// Look for app-managed Git runtime in <runtimes>/git
pub fn find_runtime_git(app: &AppHandle) -> Option<(PathBuf, String)> {
    let runtimes_dir = get_runtimes_dir(app).ok()?;
    let git_dir = runtimes_dir.join("git");
    if !git_dir.is_dir() {
        return None;
    }

    let exe_name = if cfg!(windows) { "git.exe" } else { "git" };

    let mut candidates = vec![
        git_dir.join("cmd").join(exe_name),
        git_dir.join("bin").join(exe_name),
        git_dir.join(exe_name),
    ];

    if let Ok(entries) = std::fs::read_dir(&git_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                candidates.push(entry.path().join("cmd").join(exe_name));
                candidates.push(entry.path().join("bin").join(exe_name));
                candidates.push(entry.path().join(exe_name));
            }
        }
    }

    for c in candidates {
        if c.is_file() {
            let clean = crate::server::clean_path(c);
            if let Some(ver) = run_cmd_version(&clean, "--version") {
                return Some((clean, ver));
            }
        }
    }
    None
}

/// Look for system-installed Git
pub fn check_system_git() -> Option<(PathBuf, String)> {
    // 1. Check direct PATH
    let git_cmd = Path::new("git");
    if let Some(ver) = run_cmd_version(git_cmd, "--version") {
        return Some((PathBuf::from("git"), ver));
    }

    // 2. Windows standard paths
    #[cfg(windows)]
    {
        let win_candidates = [
            "C:\\Program Files\\Git\\cmd\\git.exe",
            "C:\\Program Files\\Git\\bin\\git.exe",
            "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
        ];
        for path_str in &win_candidates {
            let p = Path::new(path_str);
            if p.is_file() {
                if let Some(ver) = run_cmd_version(p, "--version") {
                    return Some((p.to_path_buf(), ver));
                }
            }
        }
    }

    // 3. Unix standard paths
    #[cfg(unix)]
    {
        let unix_candidates = [
            "/opt/homebrew/bin/git",
            "/usr/local/bin/git",
            "/usr/bin/git",
        ];
        for path_str in &unix_candidates {
            let p = Path::new(path_str);
            if p.is_file() {
                if let Some(ver) = run_cmd_version(p, "--version") {
                    return Some((p.to_path_buf(), ver));
                }
            }
        }
    }

    None
}

/// Check overall status of Node and Git dependencies
pub fn check_all_dependencies(app: &AppHandle) -> LauncherStatus {
    let mock_missing_node = std::env::var("MOCK_MISSING_NODE").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false);
    let mock_missing_git = std::env::var("MOCK_MISSING_GIT").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false);
    let force_launcher = std::env::var("FORCE_LAUNCHER").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false);

    let node_info = find_runtime_node(app).or_else(|| {
        if force_launcher || mock_missing_node {
            None
        } else {
            check_system_node(app)
        }
    });

    let git_info = find_runtime_git(app).or_else(|| {
        if force_launcher || mock_missing_git {
            None
        } else {
            check_system_git()
        }
    });

    LauncherStatus {
        node_installed: node_info.is_some(),
        node_version: node_info.as_ref().map(|(_, v)| v.clone()),
        node_path: node_info.as_ref().map(|(p, _)| p.to_string_lossy().to_string()),
        git_installed: git_info.is_some(),
        git_version: git_info.as_ref().map(|(_, v)| v.clone()),
        git_path: git_info.as_ref().map(|(p, _)| p.to_string_lossy().to_string()),
        platform: std::env::consts::OS.to_string(),
    }
}

/// Download a file from a list of URLs (with fallback support) with real-time progress callbacks
async fn download_file_with_fallback<F>(
    urls: &[&str],
    dest: &Path,
    mut progress_cb: F,
) -> Result<(), String>
where
    F: FnMut(u64, Option<u64>, u32) + Send + 'static,
{
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let mut last_err = String::from("No URLs provided");

    for &url in urls {
        if CANCEL_REQUESTED.load(Ordering::Relaxed) {
            return Err("Installation cancelled by user".to_string());
        }

        println!("[launcher] Trying download from: {url}");
        match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() => {
                let total_size = resp.content_length();
                let mut stream = resp.bytes_stream();
                let mut downloaded: u64 = 0;

                let mut out_file = match tokio::fs::File::create(dest).await {
                    Ok(f) => f,
                    Err(e) => {
                        last_err = format!("Failed to create destination file {:?}: {e}", dest);
                        continue;
                    }
                };

                use tokio::io::AsyncWriteExt;
                let mut stream_failed = false;

                while let Some(chunk_res) = stream.next().await {
                    if CANCEL_REQUESTED.load(Ordering::Relaxed) {
                        let _ = tokio::fs::remove_file(dest).await;
                        return Err("Installation cancelled by user".to_string());
                    }

                    match chunk_res {
                        Ok(chunk) => {
                            if let Err(e) = out_file.write_all(&chunk).await {
                                last_err = format!("Failed to write to file: {e}");
                                stream_failed = true;
                                break;
                            }
                            downloaded += chunk.len() as u64;
                            let percent = if let Some(tot) = total_size {
                                if tot > 0 {
                                    ((downloaded as f64 / tot as f64) * 100.0).min(100.0) as u32
                                } else {
                                    0
                                }
                            } else {
                                0
                            };
                            progress_cb(downloaded, total_size, percent);
                        }
                        Err(e) => {
                            last_err = format!("Stream error from {url}: {e}");
                            stream_failed = true;
                            break;
                        }
                    }
                }

                if !stream_failed {
                    if let Err(e) = out_file.flush().await {
                        last_err = format!("Failed to flush file: {e}");
                    } else {
                        return Ok(());
                    }
                }
                let _ = tokio::fs::remove_file(dest).await;
            }
            Ok(resp) => {
                last_err = format!("Download failed with status: {} from {url}", resp.status());
            }
            Err(e) => {
                last_err = format!("Request error for {url}: {e}");
            }
        }
    }

    Err(last_err)
}

/// Unpack a .zip archive, stripping top-level directory if all files share one common prefix
fn extract_zip(zip_path: &Path, target_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(target_dir)
        .map_err(|e| format!("Failed to create target dir {:?}: {e}", target_dir))?;

    let file = std::fs::File::open(zip_path)
        .map_err(|e| format!("Failed to open zip archive {:?}: {e}", zip_path))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Failed to read zip archive: {e}"))?;

    // Determine if there is a common top-level directory (e.g. "node-v20.18.0-win-x64/")
    let mut common_prefix: Option<String> = None;
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            let name = entry.name().to_string();
            let first_part = name.split('/').next().unwrap_or("").to_string();
            if first_part.is_empty() {
                continue;
            }
            match &common_prefix {
                None => common_prefix = Some(first_part),
                Some(prefix) if prefix != &first_part => {
                    common_prefix = None;
                    break;
                }
                _ => {}
            }
        }
    }

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read entry {i} from zip: {e}"))?;
        let raw_name = entry.name().to_string();
        let relative_path = if let Some(ref prefix) = common_prefix {
            if let Some(stripped) = raw_name.strip_prefix(prefix) {
                stripped.trim_start_matches('/')
            } else {
                &raw_name
            }
        } else {
            &raw_name
        };

        if relative_path.is_empty() {
            continue;
        }

        let out_path = target_dir.join(relative_path);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("Failed to create directory {:?}: {e}", out_path))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent dir {:?}: {e}", parent))?;
            }
            let mut outfile = std::fs::File::create(&out_path)
                .map_err(|e| format!("Failed to create output file {:?}: {e}", out_path))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Failed to write to file {:?}: {e}", out_path))?;
        }
    }

    Ok(())
}

/// Unpack a .tar.gz archive (used for macOS Node.js)
#[cfg(unix)]
fn extract_tar_gz(tar_gz_path: &Path, target_dir: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::create_dir_all(target_dir)
        .map_err(|e| format!("Failed to create target dir {:?}: {e}", target_dir))?;

    let file = std::fs::File::open(tar_gz_path)
        .map_err(|e| format!("Failed to open tar.gz archive {:?}: {e}", tar_gz_path))?;
    let gz = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(gz);

    for entry_res in archive.entries().map_err(|e| format!("Failed to read tar entries: {e}"))? {
        let mut entry = entry_res.map_err(|e| format!("Tar entry error: {e}"))?;
        let entry_path = entry.path().map_err(|e| format!("Invalid tar entry path: {e}"))?.to_path_buf();
        
        // Strip the first component (e.g. node-v20.18.0-darwin-arm64/)
        let mut components = entry_path.components();
        components.next(); // skip root
        let relative: PathBuf = components.collect();
        if relative.as_os_str().is_empty() {
            continue;
        }

        let dest = target_dir.join(&relative);
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&dest)
                .map_err(|e| format!("Failed to create dir {:?}: {e}", dest))?;
        } else {
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent dir {:?}: {e}", parent))?;
            }
            entry.unpack(&dest)
                .map_err(|e| format!("Failed to unpack to {:?}: {e}", dest))?;

            // Ensure executable bits for binaries in bin/
            if relative.starts_with("bin") || relative == Path::new("node") {
                if let Ok(metadata) = std::fs::metadata(&dest) {
                    let mut perms = metadata.permissions();
                    perms.set_mode(0o755);
                    let _ = std::fs::set_permissions(&dest, perms);
                }
            }
        }
    }

    Ok(())
}

#[cfg(not(unix))]
#[allow(dead_code)]
fn extract_tar_gz(_tar_gz_path: &Path, _target_dir: &Path) -> Result<(), String> {
    Err("tar.gz extraction not supported on this platform".to_string())
}

/// Resolve target Node version by inspecting node-target.json in resources/server or falling back to "v20.18.0"
pub fn resolve_target_node_version(app: &AppHandle) -> String {
    if let Ok(res_dir) = app.path().resource_dir() {
        let candidates = [
            res_dir.join("resources/server/node-target.json"),
            res_dir.join("server/node-target.json"),
            res_dir.join("_up_/resources/server/node-target.json"),
        ];
        for c in &candidates {
            if let Ok(content) = std::fs::read_to_string(c) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(v) = val.get("version").and_then(|v| v.as_str()) {
                        let trimmed = v.trim().trim_start_matches('v');
                        return format!("v{trimmed}");
                    }
                }
            }
        }
    }
    // Also check local dev workspace paths
    let local_candidates = [
        PathBuf::from("resources/server/node-target.json"),
        PathBuf::from("../resources/server/node-target.json"),
    ];
    for c in &local_candidates {
        if let Ok(content) = std::fs::read_to_string(c) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(v) = val.get("version").and_then(|v| v.as_str()) {
                    let trimmed = v.trim().trim_start_matches('v');
                    return format!("v{trimmed}");
                }
            }
        }
    }

    "v20.18.0".to_string()
}

/// Install Node.js runtime into <runtimes>/node
pub async fn install_node(app: &AppHandle) -> Result<(), String> {
    let runtimes_dir = get_runtimes_dir(app)?;
    let temp_dir = runtimes_dir.join("_temp");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp dir: {e}"))?;

    let handle = app.clone();
    let emit_progress = move |stage: &str, dl: u64, tot: Option<u64>, pct: u32, msg: &str| {
        let _ = handle.emit(
            "raft://launcher-progress",
            InstallProgress {
                target: "node".to_string(),
                stage: stage.to_string(),
                downloaded_bytes: dl,
                total_bytes: tot,
                percent: pct,
                message: msg.to_string(),
            },
        );
    };

    let target_ver = resolve_target_node_version(app);
    let node_version = target_ver.as_str();

    #[cfg(windows)]
    {
        let filename = format!("node-{node_version}-win-x64.zip");
        let temp_archive = temp_dir.join(&filename);
        let urls = [
            format!("https://nodejs.org/dist/{node_version}/{filename}"),
            format!("https://npmmirror.com/mirrors/node/{node_version}/{filename}"),
        ];
        let url_refs: Vec<&str> = urls.iter().map(|s| s.as_str()).collect();

        emit_progress("downloading", 0, None, 0, &format!("Downloading Node.js {node_version}..."));
        let p_handle = app.clone();
        download_file_with_fallback(&url_refs, &temp_archive, move |dl, tot, pct| {
            let _ = p_handle.emit(
                "raft://launcher-progress",
                InstallProgress {
                    target: "node".to_string(),
                    stage: "downloading".to_string(),
                    downloaded_bytes: dl,
                    total_bytes: tot,
                    percent: pct,
                    message: format!("Downloading Node.js ({:.1} MB)...", dl as f64 / 1_048_576.0),
                },
            );
        })
        .await?;

        emit_progress("extracting", 0, None, 100, "Extracting Node.js runtime...");
        let node_dest = runtimes_dir.join("node");
        extract_zip(&temp_archive, &node_dest)?;
        let _ = std::fs::remove_file(&temp_archive);

        emit_progress("verifying", 0, None, 100, "Verifying Node.js...");
        if let Some((_, ver)) = find_runtime_node(app) {
            println!("[launcher] Successfully verified Node runtime: {ver}");
            emit_progress("done", 0, None, 100, &format!("Node.js {ver} installed"));
            Ok(())
        } else {
            Err("Failed to verify installed Node.js binary".to_string())
        }
    }

    #[cfg(target_os = "macos")]
    {
        let arch = if cfg!(target_arch = "aarch64") {
            "darwin-arm64"
        } else {
            "darwin-x64"
        };
        let filename = format!("node-{node_version}-{arch}.tar.gz");
        let temp_archive = temp_dir.join(&filename);
        let urls = [
            format!("https://nodejs.org/dist/{node_version}/{filename}"),
            format!("https://npmmirror.com/mirrors/node/{node_version}/{filename}"),
        ];
        let url_refs: Vec<&str> = urls.iter().map(|s| s.as_str()).collect();

        emit_progress("downloading", 0, None, 0, &format!("Downloading Node.js {node_version} for macOS..."));
        let p_handle = app.clone();
        download_file_with_fallback(&url_refs, &temp_archive, move |dl, tot, pct| {
            let _ = p_handle.emit(
                "raft://launcher-progress",
                InstallProgress {
                    target: "node".to_string(),
                    stage: "downloading".to_string(),
                    downloaded_bytes: dl,
                    total_bytes: tot,
                    percent: pct,
                    message: format!("Downloading Node.js ({:.1} MB)...", dl as f64 / 1_048_576.0),
                },
            );
        })
        .await?;

        emit_progress("extracting", 0, None, 100, "Extracting Node.js runtime...");
        let node_dest = runtimes_dir.join("node");
        extract_tar_gz(&temp_archive, &node_dest)?;
        let _ = std::fs::remove_file(&temp_archive);

        emit_progress("verifying", 0, None, 100, "Verifying Node.js...");
        if let Some((_, ver)) = find_runtime_node(app) {
            println!("[launcher] Successfully verified Node runtime: {ver}");
            emit_progress("done", 0, None, 100, &format!("Node.js {ver} installed"));
            Ok(())
        } else {
            Err("Failed to verify installed Node.js binary".to_string())
        }
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        Err("Unsupported operating system for automated Node.js installation".to_string())
    }
}

/// Install Git runtime (MinGit on Windows, guidance / trigger on macOS)
pub async fn install_git(app: &AppHandle) -> Result<(), String> {
    let runtimes_dir = get_runtimes_dir(app)?;
    let temp_dir = runtimes_dir.join("_temp");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp dir: {e}"))?;

    let handle = app.clone();
    let emit_progress = move |stage: &str, dl: u64, tot: Option<u64>, pct: u32, msg: &str| {
        let _ = handle.emit(
            "raft://launcher-progress",
            InstallProgress {
                target: "git".to_string(),
                stage: stage.to_string(),
                downloaded_bytes: dl,
                total_bytes: tot,
                percent: pct,
                message: msg.to_string(),
            },
        );
    };

    #[cfg(windows)]
    {
        let git_version = "2.47.0";
        let filename = format!("MinGit-{git_version}-64-bit.zip");
        let temp_archive = temp_dir.join(&filename);
        let urls = [
            format!("https://github.com/git-for-windows/git/releases/download/v{git_version}.windows.1/{filename}"),
            format!("https://npmmirror.com/mirrors/git-for-windows/v{git_version}.windows.1/{filename}"),
        ];
        let url_refs: Vec<&str> = urls.iter().map(|s| s.as_str()).collect();

        emit_progress("downloading", 0, None, 0, "Downloading Git portable runtime...");
        let p_handle = app.clone();
        download_file_with_fallback(&url_refs, &temp_archive, move |dl, tot, pct| {
            let _ = p_handle.emit(
                "raft://launcher-progress",
                InstallProgress {
                    target: "git".to_string(),
                    stage: "downloading".to_string(),
                    downloaded_bytes: dl,
                    total_bytes: tot,
                    percent: pct,
                    message: format!("Downloading Git ({:.1} MB)...", dl as f64 / 1_048_576.0),
                },
            );
        })
        .await?;

        emit_progress("extracting", 0, None, 100, "Extracting Git portable runtime...");
        let git_dest = runtimes_dir.join("git");
        extract_zip(&temp_archive, &git_dest)?;
        let _ = std::fs::remove_file(&temp_archive);

        emit_progress("verifying", 0, None, 100, "Verifying Git...");
        if let Some((_, ver)) = find_runtime_git(app) {
            println!("[launcher] Successfully verified Git runtime: {ver}");
            emit_progress("done", 0, None, 100, &format!("{ver} installed"));
            Ok(())
        } else {
            Err("Failed to verify installed Git binary".to_string())
        }
    }

    #[cfg(target_os = "macos")]
    {
        // On macOS, trigger xcode-select
        emit_progress("verifying", 0, None, 50, "Requesting Xcode Command Line Tools for Git...");
        let _ = std::process::Command::new("xcode-select")
            .arg("--install")
            .spawn();
        emit_progress(
            "waiting",
            0,
            None,
            50,
            "Please follow the Apple prompt to complete the Git / Command Line Tools installation.",
        );
        Ok(())
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        Err("Unsupported operating system for automated Git installation".to_string())
    }
}

/// Open the launcher webview window
pub fn open_launcher_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("launcher") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }

    let url = WebviewUrl::App("launcher.html".into());
    let window = WebviewWindowBuilder::new(app, "launcher", url)
        .title("Alpha Bro Setup")
        .inner_size(480.0, 490.0)
        .resizable(false)
        .center()
        .always_on_top(false)
        .build()?;

    let _ = window.set_focus();
    Ok(())
}

/// Close the launcher window if open
pub fn close_launcher_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("launcher") {
        let _ = w.close();
    }
}

// ----------------------------------------------------------------------------
// Tauri Commands
// ----------------------------------------------------------------------------

#[tauri::command]
pub fn get_launcher_status(app: AppHandle) -> LauncherStatus {
    check_all_dependencies(&app)
}

#[tauri::command]
pub async fn start_dependency_install(app: AppHandle) -> Result<(), String> {
    if INSTALL_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return Ok(()); // Already running
    }
    CANCEL_REQUESTED.store(false, Ordering::SeqCst);

    let app_clone = app.clone();
    let res = async move {
        let status = check_all_dependencies(&app_clone);

        if !status.node_installed {
            install_node(&app_clone).await?;
        }

        if !status.git_installed {
            install_git(&app_clone).await?;
        }

        // Final verification
        let final_status = check_all_dependencies(&app_clone);
        if !final_status.node_installed {
            return Err("Node.js installation could not be verified.".to_string());
        }
        if !final_status.git_installed && cfg!(windows) {
            return Err("Git installation could not be verified.".to_string());
        }

        Ok(())
    }
    .await;

    INSTALL_IN_PROGRESS.store(false, Ordering::SeqCst);

    match res {
        Ok(()) => {
            println!("[launcher] All required dependencies successfully installed!");
            Ok(())
        }
        Err(e) => {
            eprintln!("[launcher] Dependency installation error: {e}");
            let _ = app.emit(
                "raft://launcher-progress",
                InstallProgress {
                    target: "all".to_string(),
                    stage: "error".to_string(),
                    downloaded_bytes: 0,
                    total_bytes: None,
                    percent: 0,
                    message: e.clone(),
                },
            );
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn launch_main_app_from_launcher(app: AppHandle) -> Result<(), String> {
    println!("[launcher] Booting server and main application...");
    match crate::server::start_server(app.clone()).await {
        Ok((server_url, port, internal_token)) => {
            println!("[raft] Server running at {server_url}");

            if let Some(state) = app.try_state::<crate::ServerUrlState>() {
                if let Ok(mut guard) = state.0.lock() {
                    *guard = Some(server_url.clone());
                }
            }

            if let Err(e) = crate::tray::setup_tray(&app, server_url.clone()) {
                eprintln!("[raft] Failed to setup tray: {e}");
            }
            crate::desktop_bridge::start(app.clone(), port, internal_token);
            crate::updater::start_background_updater(app.clone());

            let _ = open::that(&server_url);

            // Close launcher window after main app is launched
            close_launcher_window(&app);
            Ok(())
        }
        Err(e) => {
            eprintln!("[launcher] Failed to start server after dependency install: {e}");
            Err(e)
        }
    }
}

#[tauri::command]
pub fn cancel_launcher_and_quit(app: AppHandle) {
    CANCEL_REQUESTED.store(true, Ordering::SeqCst);
    crate::server::stop_server();
    close_launcher_window(&app);
    app.exit(0);
}

#[tauri::command]
pub fn trigger_macos_git_cli() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("xcode-select")
            .arg("--install")
            .spawn();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_extract_zip_strips_common_prefix() {
        let temp_dir = std::env::temp_dir().join(format!("raft_test_zip_{}", uuid::Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&temp_dir);

        let zip_file_path = temp_dir.join("test.zip");
        let extract_target_dir = temp_dir.join("extracted");

        // Create a test zip with prefix "root-folder/file.txt"
        {
            let file = std::fs::File::create(&zip_file_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);

            zip.start_file("root-folder/hello.txt", options).unwrap();
            zip.write_all(b"Hello World").unwrap();

            zip.start_file("root-folder/sub/world.txt", options).unwrap();
            zip.write_all(b"Subfolder File").unwrap();

            zip.finish().unwrap();
        }

        // Test extraction
        let res = extract_zip(&zip_file_path, &extract_target_dir);
        assert!(res.is_ok(), "extract_zip failed: {:?}", res.err());

        // hello.txt should be directly under extract_target_dir (common prefix stripped)
        let hello_path = extract_target_dir.join("hello.txt");
        assert!(hello_path.is_file(), "Expected hello.txt to exist directly in target dir");
        let content = std::fs::read_to_string(hello_path).unwrap();
        assert_eq!(content, "Hello World");

        let sub_path = extract_target_dir.join("sub").join("world.txt");
        assert!(sub_path.is_file(), "Expected sub/world.txt to exist");

        // Clean up
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_system_git_detection() {
        // In this environment git is installed
        let res = check_system_git();
        if let Some((path, ver)) = res {
            assert!(!path.as_os_str().is_empty());
            assert!(ver.contains("git version"));
        }
    }
}

