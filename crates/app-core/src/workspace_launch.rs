//! Turning a scanned workspace item into a launch request.
//!
//! Split out of `workspace.rs`, which owns persistence and the Tauri commands. What belongs here is the
//! per-platform decision of *how* a `.bat` / `.ps1` / `.sh` is handed to a shell — the part that has
//! been wrong twice, in ways only visible at the shell's own command line.

use app_protocol::openshell::OpenShellRequest;
use app_protocol::shell_spec::{shell_quote, LocalShell};

#[cfg(test)]
#[path = "workspace_launch_tests.rs"]
mod tests;

/// Turn a scanned script into a launch request for the current platform. Ports Electron's
/// `scriptRunRequest`.
pub fn script_run_request(
    kind: &str,
    script_path: &str,
    script_name: &str,
    cwd: &str,
) -> OpenShellRequest {
    // `command` is one argv entry and the spawner quotes each entry itself (portable-pty's
    // `append_quoted`). Quoting the path here as well produced `cmd /c "\"D:\ws\x.bat\""`: cmd.exe does
    // not understand `\"`, so it reported the whole quoted path as an unrecognized command. A bare path
    // is correct even with spaces in it — the spawner adds the quotes exactly once.
    //
    // The other two kinds are different: their command string is parsed by PowerShell / sh, which do
    // understand quotes, so the path is quoted for *that* parser.
    let (shell, command) = if cfg!(target_os = "windows") {
        match kind {
            // `wslpath -a` translates the Windows path into the distro's mount point; WSL bash cannot
            // open `D:\ws\x.sh` as given. Single-quoting keeps the backslashes literal.
            "sh" => (
                LocalShell::Wsl,
                format!("bash \"$(wslpath -a {})\"", shell_quote(script_path)),
            ),
            "ps1" => (LocalShell::Powershell, format!("& '{script_path}'")),
            _ => (LocalShell::Cmd, script_path.to_string()),
        }
    } else {
        // POSIX: run through the login shell regardless of declared kind.
        (LocalShell::Default, format!("sh \"{script_path}\""))
    };

    OpenShellRequest {
        shell,
        cwd: Some(cwd.to_string()),
        command: Some(command),
        args: None,
        // A script pane closes when the script finishes, matching Electron.
        keep_open: false,
        name: script_name.to_string(),
    }
}

/// Shell for "open a plain terminal here".
pub fn default_shell() -> LocalShell {
    if cfg!(target_os = "windows") {
        LocalShell::Powershell
    } else {
        LocalShell::Default
    }
}
