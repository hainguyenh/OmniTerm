//! Handing a `.rdp` file to the operating system's Remote Desktop client.
//!
//! A `.rdp` file is not a script: there is no PTY, no pane, and nothing to stream back to the
//! renderer. `run_script` used to reject the whole kind ("not supported yet"), which is what the
//! workspace Play button reported on every `.rdp` row. The client is spawned detached — it owns its
//! own window and outlives the call.
//!
//! The executable is chosen by platform rather than by asking the shell to "open" the file, so the
//! only program this module can ever start is the one named here. `mstsc.exe` is resolved off PATH by
//! the OS (it lives in System32); macOS forwards to the registered handler via `open`.

use std::process::Command;

#[cfg(test)]
#[path = "rdp_launch_tests.rs"]
mod tests;

/// The Remote Desktop client for `os` plus its argv, or an error naming what is missing.
///
/// `os` takes the `std::env::consts::OS` spelling so callers can test every platform's argv from any
/// one of them.
pub fn rdp_command(path: &str, os: &str) -> Result<(String, Vec<String>), String> {
    match os {
        "windows" => Ok(("mstsc.exe".to_string(), vec![path.to_string()])),
        // `open` blocks only until the handler is launched, so it is still effectively detached.
        "macos" => Ok(("open".to_string(), vec![path.to_string()])),
        _ => Err("No Remote Desktop client is available on this platform.".to_string()),
    }
}

/// The address `mstsc /v:` connects to: the host, with `:port` only when it is not the default.
///
/// Launching by address writes no `.rdp` file, so the system client records the host in its own
/// history the way a typed connection does — instead of a Jump List entry per launch named after a
/// temporary file. Host and port come from a saved profile, so they are checked before they reach
/// an argument: a hostname, an IPv4 address or a bracketed IPv6 address, and a port in 1–65535.
pub fn rdp_address(host: &str, port: &str) -> Result<String, String> {
    let bracketed_v6 = host.len() > 2
        && host.starts_with('[')
        && host.ends_with(']')
        && host[1..host.len() - 1]
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == ':' || c == '.');
    let plain = !host.is_empty()
        && !host.starts_with(['-', '/', '.'])
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if !bracketed_v6 && !plain {
        return Err("Remote Desktop host contains unsupported characters.".to_string());
    }
    let port = port.trim();
    if port.is_empty() || port == "3389" {
        return Ok(host.to_string());
    }
    match port.parse::<u16>() {
        Ok(value) if value > 0 => Ok(format!("{host}:{value}")),
        _ => Err("Remote Desktop port must be between 1 and 65535.".to_string()),
    }
}

/// `reg.exe` arguments that pre-fill the user name the system client suggests for `address` — the
/// same `UsernameHint` value `mstsc` itself stores after a sign-in. No password is involved. `None`
/// when there is no user name, or one that could be read as a switch or carries control characters.
pub fn username_hint_args(address: &str, user: &str) -> Option<Vec<String>> {
    let user = user.trim();
    if user.is_empty() || user.starts_with(['/', '-']) || user.chars().any(char::is_control) {
        return None;
    }
    Some(vec![
        "add".to_string(),
        format!(r"HKCU\Software\Microsoft\Terminal Server Client\Servers\{address}"),
        "/v".to_string(),
        "UsernameHint".to_string(),
        "/t".to_string(),
        "REG_SZ".to_string(),
        "/d".to_string(),
        user.to_string(),
        "/f".to_string(),
    ])
}

/// Launch `path` in the OS Remote Desktop client and return as soon as it has started.
///
/// `path` must already have been through `safepath::safe_runnable_path` — this function does no
/// containment checking of its own.
pub fn launch_rdp(path: &str) -> Result<(), String> {
    launch_rdp_for_os(path, std::env::consts::OS)
}

fn launch_rdp_for_os(path: &str, os: &str) -> Result<(), String> {
    let (exe, args) = rdp_command(path, os)?;
    // spawn, not status: waiting would block the command until the user closed the session.
    Command::new(&exe)
        .args(&args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not start {exe}: {e}"))
}
