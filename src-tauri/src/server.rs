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
        let trimmed = host.trim();
        if !trimmed.is_empty() && (is_tailscale_ip_str(trimmed) || trimmed == "127.0.0.1" || trimmed == "localhost") {
            return trimmed.to_string();
        }
    }

    if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
        for (_name, ip) in interfaces {
            if let std::net::IpAddr::V4(ipv4) = ip {
                if is_tailscale_ip(ipv4) && std::net::TcpListener::bind((ipv4, 0)).is_ok() {
                    return ipv4.to_string();
                }
            }
        }
    }

    // CLI fallback: only if Tailscale is running and the IP can be bound
    let candidate_commands = [
        "tailscale",
        "/opt/homebrew/bin/tailscale",
        "/usr/local/bin/tailscale",
        "/usr/bin/tailscale",
        "C:\\Program Files\\Tailscale\\tailscale.exe",
    ];
    for cmd in candidate_commands {
        let is_running = std::process::Command::new(cmd)
            .args(["status", "--json"])
            .output()
            .ok()
            .and_then(|output| {
                if output.status.success() {
                    let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
                    Some(json.get("BackendState").and_then(|s| s.as_str()) == Some("Running"))
                } else {
                    None
                }
            })
            .unwrap_or(false);

        if !is_running {
            continue;
        }

        if let Ok(output) = std::process::Command::new(cmd).args(["ip", "-4"]).output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if is_tailscale_ip_str(trimmed) && std::net::TcpListener::bind((trimmed, 0)).is_ok() {
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
    let timeout = Duration::from_millis(150);
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        let sock_addr = std::net::SocketAddr::new(ip, port);
        if std::net::TcpStream::connect_timeout(&sock_addr, timeout).is_ok() {
            return false;
        }
    }
    let local_v4 = std::net::SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), port);
    if std::net::TcpStream::connect_timeout(&local_v4, timeout).is_ok() {
        return false;
    }
    let local_v6 = std::net::SocketAddr::new(std::net::IpAddr::V6(std::net::Ipv6Addr::LOCALHOST), port);
    if std::net::TcpStream::connect_timeout(&local_v6, timeout).is_ok() {
        return false;
    }
    if TcpListener::bind(("0.0.0.0", port)).is_err() {
        return false;
    }
    if TcpListener::bind(("127.0.0.1", port)).is_err() {
        return false;
    }
    true
}

#[cfg(unix)]
fn kill_process_on_port(port: u16) {
    println!("[raft] Port {port} is occupied; inspecting processes holding the port...");
    let current_pid = std::process::id();

    // 1. Try lsof to get PIDs holding the port
    if let Ok(output) = std::process::Command::new("lsof")
        .args(["-ti", &format!(":{port}")])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if let Ok(pid) = trimmed.parse::<u32>() {
                    if pid != current_pid && pid > 1 {
                        println!("[raft] Terminating process {pid} occupying port {port}...");
                        let _ = std::process::Command::new("kill")
                            .args(["-9", &pid.to_string()])
                            .output();
                    }
                }
            }
        }
    }

    // 2. Fallback on Linux: fuser
    let _ = std::process::Command::new("fuser")
        .args(["-k", "-n", "tcp", &port.to_string()])
        .output();
}

#[cfg(windows)]
fn kill_process_on_port(port: u16) {
    println!("[raft] Port {port} is occupied; terminating occupying processes on Windows...");
    let script = format!(
        "Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue | ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}"
    );
    let _ = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output();
}

#[cfg(not(any(unix, windows)))]
fn kill_process_on_port(_port: u16) {}

/// Ensure that the designated port is available before launching the server.
/// If port is in use (e.g. during an update restart when the previous process is shutting down),
/// it waits up to 3 seconds. If still occupied, it forcibly terminates the occupying process.
pub async fn ensure_port_available(port: u16, host: &str) -> Result<(), String> {
    if is_port_available(port, host) {
        return Ok(());
    }

    println!("[raft] Port {port} is currently in use. Waiting for it to be released...");

    // Phase 1: Wait up to 3 seconds (15 x 200ms) for the previous server to release the port naturally
    for _ in 0..15 {
        tokio::time::sleep(Duration::from_millis(200)).await;
        if is_port_available(port, host) {
            println!("[raft] Port {port} is now available.");
            return Ok(());
        }
    }

    // Phase 2: If still busy after 3 seconds, terminate any lingering process holding the port
    println!("[raft] Port {port} is still in use after 3s grace period. Terminating occupying process...");
    kill_process_on_port(port);

    // Phase 3: Wait up to 3 seconds (15 x 200ms) for port to become available after termination
    for _ in 0..15 {
        tokio::time::sleep(Duration::from_millis(200)).await;
        if is_port_available(port, host) {
            println!("[raft] Port {port} successfully reclaimed.");
            return Ok(());
        }
    }

    Err(format!(
        "Port {port} remains occupied and could not be freed after multiple attempts. Please ensure no other application is using port {port}."
    ))
}

/// Find an available port starting from `start_port` (legacy fallback)
#[allow(dead_code)]
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

    // 2. Check current executable directory (standard for bundled externalBin in Tauri)
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            let exe_name = if cfg!(windows) { "node.exe" } else { "node" };
            let p = parent.join(exe_name);
            if p.is_file() {
                return Some(p);
            }
        }
    }

    // 3. Check local dev sidecar folder (src-tauri/bin/node-...) in development mode
    if crate::is_dev() {
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
pub async fn start_server(app: AppHandle) -> Result<(String, u16, String), String> {
    let node_bin = clean_path(discover_node_binary(&app).ok_or_else(|| {
        "Node.js binary not found. Please ensure Node.js is installed or sidecar is bundled.".to_string()
    })?);

    let host = resolve_host();
    // Only honour RAFT_PORT: a generic PORT is often inherited from whatever
    // launched us (e.g. another app's terminal) and must not move Raft off 3300.
    let port = std::env::var("RAFT_PORT")
        .ok()
        .and_then(|p| p.trim().parse::<u16>().ok())
        .unwrap_or(3300);

    ensure_port_available(port, &host).await?;

    let mut entry = resolve_server_script(&app)?;
    entry.app_root = clean_path(entry.app_root);
    entry.script = clean_path(entry.script);

    let watchdog_path = clean_path(ensure_watchdog_script()?);

    let internal_token = uuid::Uuid::new_v4().to_string();

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
    cmd.stderr(std::process::Stdio::piped());

    let parent_pid = std::process::id();
    cmd.env("RAFT_PARENT_PID", parent_pid.to_string());
    cmd.env("RAFT_PORT", port.to_string());
    cmd.env("HOST", &host);
    cmd.env("NODE_ENV", "production");
    cmd.env("PATH", augmented_path());
    cmd.env("RAFT_INTERNAL_TOKEN", &internal_token);
    cmd.env("RAFT_VERSION", app.package_info().version.to_string());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn server process: {e}"))?;

    let stderr = child.stderr.take();
    let stderr_lines = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
    let stderr_lines_clone = stderr_lines.clone();

    if let Some(err_stream) = stderr {
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(err_stream);
            for line in reader.lines().flatten() {
                eprintln!("{line}");
                if let Ok(mut buf) = stderr_lines_clone.lock() {
                    if buf.len() >= 30 {
                        buf.remove(0);
                    }
                    buf.push(line);
                }
            }
        });
    }

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

        let exit_status = {
            let mut proc_guard = SERVER_PROCESS.lock().unwrap();
            proc_guard
                .as_mut()
                .and_then(|proc| proc.child.try_wait().ok().flatten())
        };

        if let Some(status) = exit_status {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let details = if let Ok(buf) = stderr_lines.lock() {
                if buf.is_empty() {
                    String::new()
                } else {
                    format!("\n\n{}", buf.join("\n"))
                }
            } else {
                String::new()
            };
            return Err(format!("Server process exited prematurely with status: {status}{details}"));
        }

        let is_ok = if let Ok(resp) = client.get(&health_url).send().await {
            resp.status().is_success()
        } else if host != "127.0.0.1" {
            let loopback_url = format!("http://127.0.0.1:{port}/api/settings");
            client
                .get(&loopback_url)
                .send()
                .await
                .map(|resp| resp.status().is_success())
                .unwrap_or(false)
        } else {
            false
        };

        if is_ok {
            is_ready = true;
            break;
        }
    }

    if !is_ready {
        stop_server();
        return Err(format!("Server did not become ready at {health_url} within 25 seconds."));
    }

    let server_url = format!("http://{}:{}", host, port);
    println!("[raft] Server successfully verified ready at {}", server_url);
    Ok((server_url, port, internal_token))
}

/// Stop the background server
pub fn stop_server() {
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
    let mut proc_guard = SERVER_PROCESS.lock().unwrap();
    if let Some(mut proc) = proc_guard.take() {
        println!("[raft] Stopping server process (PID: {})...", proc.pid);
        // Give Node time to terminate its detached preview process groups.
        #[cfg(unix)]
        {
            let _ = std::process::Command::new("kill")
                .args(["-TERM", &proc.pid.to_string()])
                .status();
            for _ in 0..60 {
                if matches!(proc.child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        let _ = proc.child.kill();
        let _ = proc.child.wait();
    }
}
