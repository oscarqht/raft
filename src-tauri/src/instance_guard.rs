//! Startup guard against duplicate app instances and orphaned server processes.
//!
//! Runs before the Tauri app is built (and therefore before the single-instance
//! plugin silently forwards to an existing instance and exits). If another app
//! instance or a leftover Node server is found, the user chooses whether to kill
//! them and start fresh, or quit this launch.

use std::time::{Duration, Instant};

/// Marker present in every server command line (see `server::ensure_watchdog_script`).
const SERVER_MARKER: &str = "raft-parent-watchdog.cjs";

#[derive(Debug, Clone, PartialEq, Eq)]
enum Kind {
    App,
    Server,
}

#[derive(Debug, Clone)]
struct Found {
    pid: u32,
    kind: Kind,
    command: String,
}

enum Decision {
    Continue,
    Quit,
}

/// Check for other instances/orphans and prompt the user if any are found.
/// Never returns if the user chooses to quit (or if a non-interactive launch
/// finds an existing app instance, it defers to the single-instance plugin).
pub fn check(identifier: &str) {
    let mut found = detect(identifier);
    if found.is_empty() {
        return;
    }

    // An app restart (updater / tauri restart) spawns us while the previous
    // process is still shutting down. Give it a moment to go away on its own.
    let deadline = Instant::now() + Duration::from_secs(3);
    while !found.is_empty() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(200));
        found = detect(identifier);
    }
    if found.is_empty() {
        return;
    }

    let has_app = found.iter().any(|f| f.kind == Kind::App);
    let non_interactive = std::env::args().any(|a| a == "--autostart" || a == "--silent");

    if non_interactive {
        // No one to ask: keep the old behaviour. An existing instance wins
        // (single-instance plugin forwards and exits); orphan servers are
        // cleaned up so they don't block the port.
        if !has_app {
            println!("[raft] Cleaning up {} orphaned server process(es)...", found.len());
            kill_all(&found);
        }
        return;
    }

    match prompt(&found) {
        Decision::Continue => {
            println!("[raft] Terminating {} existing process(es) at user request...", found.len());
            kill_all(&found);
            #[cfg(target_os = "macos")]
            let _ = std::fs::remove_file(socket_path(identifier));
        }
        Decision::Quit => {
            println!("[raft] Another instance is running; quitting this launch at user request.");
            std::process::exit(0);
        }
    }
}

fn prompt(found: &[Found]) -> Decision {
    let apps: Vec<&Found> = found.iter().filter(|f| f.kind == Kind::App).collect();
    let servers: Vec<&Found> = found.iter().filter(|f| f.kind == Kind::Server).collect();

    let mut msg = String::new();
    if !apps.is_empty() {
        msg.push_str("Another Alpha Bro instance is already running.\n");
    } else {
        msg.push_str("Leftover Alpha Bro server processes from a previous run were found.\n");
    }
    msg.push('\n');
    for f in apps.iter().chain(servers.iter()) {
        let label = if f.kind == Kind::App { "App" } else { "Server" };
        msg.push_str(&format!("• {label} (PID {}): {}\n", f.pid, truncate(&f.command, 80)));
    }
    msg.push_str("\nKill them and start a new instance, or quit this one?");

    #[cfg(target_os = "macos")]
    bring_to_front();

    const KILL: &str = "Kill & Start New";
    const QUIT: &str = "Quit";
    let result = rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Warning)
        .set_title("Alpha Bro Is Already Running")
        .set_description(msg)
        .set_buttons(rfd::MessageButtons::OkCancelCustom(KILL.into(), QUIT.into()))
        .show();

    match result {
        rfd::MessageDialogResult::Custom(s) if s == KILL => Decision::Continue,
        rfd::MessageDialogResult::Ok | rfd::MessageDialogResult::Yes => Decision::Continue,
        _ => Decision::Quit,
    }
}

/// The app hasn't finished launching yet and is not frontmost, so without this
/// the alert would open behind other windows.
#[cfg(target_os = "macos")]
fn bring_to_front() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
    if let Some(mtm) = MainThreadMarker::new() {
        let app = NSApplication::sharedApplication(mtm);
        app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max).collect::<String>())
    }
}

fn current_exe_name() -> Option<String> {
    std::env::current_exe()
        .ok()?
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
}

#[cfg(target_os = "macos")]
fn socket_path(identifier: &str) -> std::path::PathBuf {
    // Mirrors tauri-plugin-single-instance's macOS socket naming.
    let id = identifier.replace(['.', '-'], "_");
    std::path::PathBuf::from(format!("/tmp/{id}_si.sock"))
}

#[cfg(unix)]
fn run_lines(cmd: &str, args: &[&str]) -> Vec<String> {
    std::process::Command::new(cmd)
        .args(args)
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(unix)]
fn detect(identifier: &str) -> Vec<Found> {
    let self_pid = std::process::id();
    let mut app_pids: Vec<u32> = Vec::new();

    // Processes with the same executable name (p_comm is capped at 15 chars).
    if let Some(name) = current_exe_name() {
        let comm: String = name.chars().take(15).collect();
        for line in run_lines("pgrep", &["-x", &comm]) {
            if let Ok(pid) = line.parse() {
                app_pids.push(pid);
            }
        }
    }

    // Whoever holds the single-instance socket (covers dev vs installed builds,
    // which share the identifier but have different executable names).
    #[cfg(target_os = "macos")]
    {
        let socket = socket_path(identifier);
        if socket.exists() {
            for line in run_lines("lsof", &["-t", &socket.to_string_lossy()]) {
                if let Ok(pid) = line.parse() {
                    app_pids.push(pid);
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = identifier;

    let mut found: Vec<Found> = Vec::new();
    for pid in app_pids {
        if pid != self_pid && !found.iter().any(|f| f.pid == pid) {
            found.push(Found { pid, kind: Kind::App, command: command_of(pid) });
        }
    }

    for line in run_lines("pgrep", &["-f", SERVER_MARKER]) {
        if let Ok(pid) = line.parse::<u32>() {
            if pid != self_pid && !found.iter().any(|f| f.pid == pid) {
                found.push(Found { pid, kind: Kind::Server, command: command_of(pid) });
            }
        }
    }

    // Drop anything that exited between listing and inspection.
    found.retain(|f| !f.command.is_empty());
    found
}

#[cfg(unix)]
fn command_of(pid: u32) -> String {
    run_lines("ps", &["-o", "command=", "-p", &pid.to_string()])
        .into_iter()
        .next()
        .unwrap_or_default()
}

#[cfg(unix)]
fn is_alive(pid: u32) -> bool {
    // SAFETY: signal 0 only checks for existence/permission.
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[cfg(unix)]
fn kill_all(found: &[Found]) {
    for f in found {
        // SAFETY: plain kill(2) on a PID we just discovered.
        unsafe {
            libc::kill(f.pid as libc::pid_t, libc::SIGTERM);
        }
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline && found.iter().any(|f| is_alive(f.pid)) {
        std::thread::sleep(Duration::from_millis(100));
    }
    for f in found.iter().filter(|f| is_alive(f.pid)) {
        println!("[raft] PID {} did not exit after SIGTERM; sending SIGKILL", f.pid);
        // SAFETY: as above.
        unsafe {
            libc::kill(f.pid as libc::pid_t, libc::SIGKILL);
        }
    }
    std::thread::sleep(Duration::from_millis(200));
}

#[cfg(windows)]
fn powershell(script: &str) -> String {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default()
}

#[cfg(windows)]
fn detect(_identifier: &str) -> Vec<Found> {
    let self_pid = std::process::id();
    let exe = current_exe_name().unwrap_or_else(|| "raft.exe".to_string()).replace('\'', "''");
    let script = format!(
        "Get-CimInstance Win32_Process | Where-Object {{ $_.Name -ne 'powershell.exe' -and $_.Name -ne 'pwsh.exe' -and ($_.Name -eq '{exe}' -or $_.CommandLine -like '*{SERVER_MARKER}*') }} | ForEach-Object {{ \"$($_.ProcessId)`t$($_.Name)`t$($_.CommandLine)\" }}"
    );
    powershell(&script)
        .lines()
        .filter_map(|line| {
            let mut parts = line.trim().splitn(3, '\t');
            let pid: u32 = parts.next()?.parse().ok()?;
            let name = parts.next().unwrap_or_default();
            let command = parts.next().unwrap_or_default().to_string();
            if pid == self_pid || name.eq_ignore_ascii_case("powershell.exe") || name.eq_ignore_ascii_case("pwsh.exe") {
                return None;
            }
            let kind = if name.eq_ignore_ascii_case(&exe) { Kind::App } else { Kind::Server };
            Some(Found { pid, kind, command: if command.is_empty() { name.to_string() } else { command } })
        })
        .collect()
}

#[cfg(windows)]
fn kill_all(found: &[Found]) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    for f in found {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &f.pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    std::thread::sleep(Duration::from_millis(300));
}

#[cfg(not(any(unix, windows)))]
fn detect(_identifier: &str) -> Vec<Found> {
    Vec::new()
}

#[cfg(not(any(unix, windows)))]
fn kill_all(_found: &[Found]) {}
