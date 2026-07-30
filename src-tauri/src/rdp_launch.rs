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

/// Launch `path` in the OS Remote Desktop client and return as soon as it has started.
///
/// `path` must already have been through `safepath::safe_runnable_path` — this function does no
/// containment checking of its own.
pub fn launch_rdp(path: &str) -> Result<(), String> {
    let (exe, args) = rdp_command(path, std::env::consts::OS)?;
    // spawn, not status: waiting would block the command until the user closed the session.
    Command::new(&exe)
        .args(&args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not start {exe}: {e}"))
}
