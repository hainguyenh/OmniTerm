//! Which of the supported shells actually exist on this machine.
//!
//! The renderer used to carry its own hardcoded list — "Windows PowerShell / Command Prompt / WSL" —
//! in four places. On macOS and Linux every entry in it was a shell `LocalShell::is_supported_here`
//! rejects, and on Windows it offered WSL whether or not WSL was installed (plus a "Git Bash" entry
//! that was never a `LocalShell` at all). The list belongs here, next to `resolve_exe`, because this
//! is the only place that knows what will really spawn.
//!
//! The set of *candidates* stays closed — this enumerates `LocalShell`, it never discovers arbitrary
//! executables — so nothing here widens what `LocalShell::parse` will accept.

use crate::shell_spec::LocalShell;
use serde::Serialize;

#[cfg(test)]
#[path = "shell_probe_tests.rs"]
mod tests;

/// One entry in the renderer's shell picker. `id` round-trips through `LocalShell::parse`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellOption {
    pub id: String,
    pub label: String,
}

impl ShellOption {
    fn new(shell: LocalShell, label: &str) -> Self {
        Self {
            id: shell.as_str().to_string(),
            label: label.to_string(),
        }
    }
}

/// The shells present on this machine, most-canonical first.
///
/// `on_path` is injected so tests do not depend on what happens to be installed on the machine running
/// them. `cmd` is always present; PowerShell is labelled by which one resolved; WSL appears only when
/// `wsl.exe` is really on PATH — `LocalShell::resolve_exe` returns `"wsl.exe"` unconditionally, so
/// without this probe the picker offered WSL on machines that have never installed it.
#[cfg(target_os = "windows")]
pub fn available_shells(on_path: impl Fn(&str) -> bool) -> Vec<ShellOption> {
    let mut out = vec![
        ShellOption::new(
            LocalShell::Powershell,
            if on_path("pwsh.exe") {
                "PowerShell 7"
            } else {
                "Windows PowerShell"
            },
        ),
        ShellOption::new(LocalShell::Cmd, LocalShell::Cmd.label()),
    ];
    if on_path("wsl.exe") {
        out.push(ShellOption::new(
            LocalShell::Wsl,
            "Windows Subsystem for Linux (WSL)",
        ));
    }
    out
}

/// The shells present on this machine, most-canonical first.
///
/// `is_exec` is injected for the same reason as on Windows. The login shell always leads; each concrete
/// shell is offered only when it resolves, reusing `resolve_posix_shell` so the picker and the spawner
/// can never disagree about what is installed.
#[cfg(not(target_os = "windows"))]
pub fn available_shells(is_exec: impl Fn(&str) -> bool) -> Vec<ShellOption> {
    let mut out = vec![ShellOption::new(LocalShell::Default, "Default login shell")];
    for shell in [LocalShell::Zsh, LocalShell::Bash, LocalShell::Sh] {
        if crate::shell_spec::resolve_posix_shell(shell, &is_exec).is_ok() {
            out.push(ShellOption::new(shell, shell.label()));
        }
    }
    out
}

/// The shells the renderer may offer. Never empty: `cmd` on Windows and the login shell on POSIX are
/// always included, so the picker always has something valid to select.
#[tauri::command]
pub async fn list_available_shells() -> Vec<ShellOption> {
    #[cfg(target_os = "windows")]
    {
        available_shells(crate::shell_spec::is_on_path)
    }
    #[cfg(not(target_os = "windows"))]
    {
        available_shells(|p| crate::shell_spec::is_executable(std::path::Path::new(p)))
    }
}
