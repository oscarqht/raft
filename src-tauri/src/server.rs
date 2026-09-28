use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const WATCHDOG_SCRIPT: &str = include_str!("../../scripts/parent-watchdog.cjs");

pub fn clean_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let s = path.to_string_lossy();
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    path
}

fn ensure_watchdog_script() -> Result<PathBuf, String> {
    let temp_dir = std::env::temp_dir();
    let watchdog_path = clean_path(temp_dir.join("raft-parent-watchdog.cjs"));
    std::fs::write(&watchdog_path, WATCHDOG_SCRIPT)
        .map_err(|e| format!("Failed to write watchdog script to {:?}: {e}", watchdog_path))?;
    Ok(watchdog_path)
}

pub struct ServerProcess {
    pub pid: u32,
    pub child: std::process::Child,
}

static SERVER_PROCESS: Mutex<Option<ServerProcess>> = Mutex::new(None);
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

/// Tailscale assigns addresses from the CGNAT range 100.64.0.0/10 (100.64.0.0 - 100.127.255.255).
pub fn is_tailscale_ip(ipv4: std::net::Ipv4Addr) -> bool {
    let octets = ipv4.octets();
    octets[0] == 100 && (64..=127).contains(&octets[1])
}

pub fn is_tailscale_ip_str(ip_str: &str) -> bool {
    if let Ok(ip) = ip_str.trim().parse::<std::net::Ipv4Addr>() {
        is_tailscale_ip(ip)
    } else {
        false
    }
}

/// Resolve the host to bind to. Looks for Tailscale IP (100.64.0.0/10), falling back to 127.0.0.1.
pub fn resolve_host() -> String {
    if let Ok(host) = std::env::var("HOST") {
        if !host.trim().is_empty() {
            return host.trim().to_string();
        }
    }
    if let Ok(host) = std::env::var("TAILSCALE_IP") {
        if !host.trim().is_empty() {
            return host.trim().to_string();
        }
    }
    if let Ok(host) = std::env::var("HOSTNAME") {
        if !host.trim().is_empty() {
            return host.trim().to_string();
        }
    }

    if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
        for (_name, ip) in interfaces {
            if let std::net::IpAddr::V4(ipv4) = ip {
                if is_tailscale_ip(ipv4) {
                    return ipv4.to_string();
                }
            }
        }
    }

    // CLI fallback: try `tailscale ip -4`
    let candidate_commands = [
        "tailscale",
        "/opt/homebrew/bin/tailscale",
        "/usr/local/bin/tailscale",
        "/usr/bin/tailscale",
        "C:\\Program Files\\Tailscale\\tailscale.exe",
    ];
    for cmd in candidate_commands {
        if let Ok(output) = std::process::Command::new(cmd).args(["ip", "-4"]).output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if is_tailscale_ip_str(trimmed) {
                        return trimmed.to_string();
                    }
                }
            }
        }
    }

    "127.0.0.1".to_string()
}

/// Check if a local port is available to bind
fn is_port_available(port: u16, host: &str) -> bool {
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        if std::net::TcpStream::connect((ip, port)).is_ok() {
            return false;
        }
    }
    if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
        return false;
    }
    if std::net::TcpStream::connect(("::1", port)).is_ok() {
        return false;
    }
    if TcpListener::bind(("0.0.0.0", port)).is_err() {
        return false;
    }
    if TcpListener::bind(("::", port)).is_err() {
        return false;
    }
    true
}

/// Find an available port starting from `start_port`
pub fn find_available_port(start_port: u16, max_attempts: u16, host: &str) -> Option<u16> {
    for port in start_port..(start_port + max_attempts) {
        if is_port_available(port, host) {
            return Some(port);
        }
    }
    None
}

/// Discover Node.js executable: checks bundled sidecar first, then system installations
pub fn discover_node_binary(app: &AppHandle) -> Option<PathBuf> {
    // 1. Check bundled sidecar in resource_dir
    if let Ok(res_dir) = app.path().resource_dir() {
        let exe_name = if cfg!(windows) { "node.exe" } else { "node" };
        let candidates = [
            res_dir.join(exe_name),
            res_dir.join("bin").join(exe_name),
            res_dir.join("_up_").join("bin").join(exe_name),
        ];
        for c in &candidates {
            if c.is_file() {
                return Some(c.clone());
            }
        }
    }

    // 2. Check local dev sidecar folder (src-tauri/bin/node-...)
    if let Ok(cwd) = std::env::current_dir() {
        let target_triple = if cfg!(windows) {
            "x86_64-pc-windows-msvc"
        } else {
            "aarch64-apple-darwin"
        };
        let sidecar_name = if cfg!(windows) {
            format!("node-{target_triple}.exe")
        } else {
            format!("node-{target_triple}")
        };
        let candidates = [
            cwd.join("src-tauri").join("bin").join(&sidecar_name),
            cwd.join("bin").join(&sidecar_name),
        ];
        for c in &candidates {
            if c.is_file() {
                return Some(c.clone());
            }
        }
    }

    // 3. Check current executable directory
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            let exe_name = if cfg!(windows) { "node.exe" } else { "node" };
            let p = parent.join(exe_name);
            if p.is_file() {
                return Some(p);
            }
        }
    }

    // 4. Check if "node" is directly runnable from current PATH
    if let Ok(output) = std::process::Command::new("node").arg("--version").output() {
        if output.status.success() {
            return Some(PathBuf::from("node"));
        }
    }

    // 5. Common fixed paths on macOS and Linux
    let known_paths = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
        "/bin/node",
    ];
    for path_str in &known_paths {
        let p = Path::new(path_str);
        if p.is_file() {
            return Some(p.to_path_buf());
        }
    }

    // 6. Check Home directory paths (~/.nvm, ~/.fnm, ~/.volta, ~/.asdf)
    if let Some(home) = dirs::home_dir() {
        let fnm_node = home.join(".fnm/current/bin/node");
        if fnm_node.is_file() {
            return Some(fnm_node);
        }
        let volta_node = home.join(".volta/bin/node");
        if volta_node.is_file() {
            return Some(volta_node);
        }
        let asdf_node = home.join(".asdf/shims/node");
        if asdf_node.is_file() {
            return Some(asdf_node);
        }

        let nvm_versions = home.join(".nvm/versions/node");
        if nvm_versions.is_dir() {
            if let Ok(entries) = std::fs::read_dir(nvm_versions) {
                let mut versions: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.path().join("bin/node"))
                    .filter(|p| p.is_file())
                    .collect();
                versions.sort();
                if let Some(latest) = versions.pop() {
                    return Some(latest);
                }
            }
        }
    }

    // 7. Check Windows standard installations
    if cfg!(windows) {
        let win_paths = [
            "C:\\Program Files\\nodejs\\node.exe",
            "C:\\Program Files (x86)\\nodejs\\node.exe",
        ];
        for path_str in &win_paths {
            let p = Path::new(path_str);
            if p.is_file() {
                return Some(p.to_path_buf());
            }
        }
    }

    None
}

/// Build an augmented PATH environment string
fn augmented_path() -> String {
    let mut candidate_paths: Vec<PathBuf> = Vec::new();

    if let Some(home) = dirs::home_dir() {
        candidate_paths.push(home.join(".bun/bin"));
        candidate_paths.push(home.join(".cargo/bin"));
        candidate_paths.push(home.join(".local/bin"));
        candidate_paths.push(home.join(".pnpm"));
        candidate_paths.push(home.join(".fnm/current/bin"));
        candidate_paths.push(home.join(".volta/bin"));
        candidate_paths.push(home.join(".asdf/shims"));

        #[cfg(windows)]
        {
            candidate_paths.push(home.join("AppData/Local/pnpm"));
            candidate_paths.push(home.join("AppData/Roaming/npm"));
            candidate_paths.push(PathBuf::from("C:\\Program Files\\Git\\cmd"));
            candidate_paths.push(PathBuf::from("C:\\Program Files\\Git\\bin"));
            candidate_paths.push(PathBuf::from("C:\\Program Files\\nodejs"));
        }
    }

    #[cfg(unix)]
    {
        candidate_paths.push(PathBuf::from("/opt/homebrew/bin"));
        candidate_paths.push(PathBuf::from("/usr/local/bin"));
        candidate_paths.push(PathBuf::from("/usr/bin"));
        candidate_paths.push(PathBuf::from("/bin"));
    }

    if let Ok(existing) = std::env::var("PATH") {
        for p in std::env::split_paths(&existing) {
            candidate_paths.push(p);
        }
    }

    let mut seen = std::collections::HashSet::new();
    let mut final_paths = Vec::new();

    for path in candidate_paths {
        if path.is_dir() && seen.insert(path.clone()) {
            final_paths.push(path);
        }
    }

    std::env::join_paths(final_paths)
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

pub struct ServerEntry {
    pub app_root: PathBuf,
    pub script: PathBuf,
}

/// Locate server entrypoint (resources/server/index.mjs or server/dist/index.js)
fn resolve_server_script(app: &AppHandle) -> Result<ServerEntry, String> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let parent = cwd.parent().unwrap_or(&cwd);

    // 1. Packaged resource directory
    if let Ok(res_dir) = app.path().resource_dir() {
        let candidates = [
            res_dir.join("resources/server/index.mjs"),
            res_dir.join("server/index.mjs"),
            res_dir.join("_up_/resources/server/index.mjs"),
            res_dir.join("resources/server/dist/index.js"),
        ];
        for c in &candidates {
            if c.is_file() {
                let root = c.parent().unwrap_or(&res_dir).to_path_buf();
                return Ok(ServerEntry {
                    app_root: root,
                    script: c.clone(),
                });
            }
        }
    }

    // 2. Local workspace directory
    let local_candidates = [
        cwd.join("resources/server/index.mjs"),
        parent.join("resources/server/index.mjs"),
        cwd.join("server/dist/index.js"),
        parent.join("server/dist/index.js"),
    ];
    for c in &local_candidates {
        if c.is_file() {
            let root = c.parent().unwrap_or(&cwd).to_path_buf();
            return Ok(ServerEntry {
                app_root: root,
                script: c.clone(),
            });
        }
    }

    Err(format!(
        "Could not locate Raft server bundle (resources/server/index.mjs). Checked cwd: {}",
        cwd.display()
    ))
}

/// Start background Node.js server
pub async fn start_server(app: AppHandle) -> Result<(String, u16), String> {
    let node_bin = clean_path(discover_node_binary(&app).ok_or_else(|| {
        "Node.js binary not found. Please ensure Node.js is installed or sidecar is bundled.".to_string()
    })?);

    let host = resolve_host();
    let port = find_available_port(3301, 20, &host)
        .ok_or_else(|| "No available port found between 3301 and 3321.".to_string())?;

    let mut entry = resolve_server_script(&app)?;
    entry.app_root = clean_path(entry.app_root);
    entry.script = clean_path(entry.script);

    let watchdog_path = clean_path(ensure_watchdog_script()?);

    println!("[raft] Launching server with Node: {}", node_bin.display());
    println!("[raft] Server root: {}", entry.app_root.display());
    println!("[raft] Script: {}", entry.script.display());
    println!("[raft] Binding to {}:{}", host, port);

    let mut cmd = std::process::Command::new(&node_bin);
    cmd.arg("--require");
    cmd.arg(&watchdog_path);
    cmd.arg(&entry.script);
    cmd.current_dir(&entry.app_root);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::inherit());
    cmd.stderr(std::process::Stdio::inherit());

    let parent_pid = std::process::id();
    cmd.env("RAFT_PARENT_PID", parent_pid.to_string());
    cmd.env("PORT", port.to_string());
    cmd.env("HOST", &host);
    cmd.env("NODE_ENV", "production");
    cmd.env("PATH", augmented_path());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn server process: {e}"))?;

    let pid = child.id();
    {
        let mut proc_guard = SERVER_PROCESS.lock().unwrap();
        *proc_guard = Some(ServerProcess { pid, child });
    }

    // Health-check polling: wait for HTTP server to respond
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let health_url = format!("http://{}:{}/api/settings", host, port);
    let start_time = std::time::Instant::now();
    let timeout = Duration::from_secs(25);
    let mut is_ready = false;

    while start_time.elapsed() < timeout {
        tokio::time::sleep(Duration::from_millis(250)).await;

        {
            let mut proc_guard = SERVER_PROCESS.lock().unwrap();
            if let Some(ref mut proc) = *proc_guard {
                if let Ok(Some(status)) = proc.child.try_wait() {
                    return Err(format!("Server process exited prematurely with status: {status}"));
                }
            }
        }

        if let Ok(resp) = client.get(&health_url).send().await {
            if resp.status().is_success() {
                is_ready = true;
                break;
            }
        }
    }

    if !is_ready {
        stop_server();
        return Err(format!("Server did not become ready at {health_url} within 25 seconds."));
    }

    let server_url = format!("http://{}:{}", host, port);
    println!("[raft] Server successfully verified ready at {}", server_url);
    Ok((server_url, port))
}

/// Stop the background server
pub fn stop_server() {
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
    let mut proc_guard = SERVER_PROCESS.lock().unwrap();
    if let Some(mut proc) = proc_guard.take() {
        println!("[raft] Stopping server process (PID: {})...", proc.pid);
        let _ = proc.child.kill();
        let _ = proc.child.wait();
    }
}
