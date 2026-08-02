//! Shell enumeration: only what is installed, and only ids the launcher will accept.

use super::*;

/// Whatever this platform reports, every id must survive the same parse the spawn path applies, and
/// must be usable here — the old hardcoded renderer list failed both on macOS.
#[test]
fn every_offered_shell_is_parseable_and_supported_here() {
    let all = available_shells(|_| true);
    assert!(!all.is_empty(), "the picker must never be empty");
    for opt in &all {
        let parsed = LocalShell::parse(&opt.id)
            .unwrap_or_else(|| panic!("{} is not a LocalShell", opt.id));
        assert!(parsed.is_supported_here(), "{} is foreign here", opt.id);
        assert!(!opt.label.is_empty(), "{} has no label", opt.id);
    }
}

#[test]
fn ids_are_unique() {
    let all = available_shells(|_| true);
    let mut ids: Vec<&str> = all.iter().map(|o| o.id.as_str()).collect();
    ids.sort_unstable();
    let count = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), count, "duplicate shell ids: {ids:?}");
}

#[test]
fn the_option_serializes_as_the_renderer_reads_it() {
    let json = serde_json::to_value(ShellOption::new(LocalShell::Cmd, "Command Prompt")).unwrap();
    assert_eq!(json["id"], "cmd");
    assert_eq!(json["label"], "Command Prompt");
}

#[cfg(target_os = "windows")]
mod windows {
    use super::*;

    fn ids(all: &[ShellOption]) -> Vec<&str> {
        all.iter().map(|o| o.id.as_str()).collect()
    }

    /// The reported bug: WSL was offered unconditionally, so selecting it on a machine without WSL
    /// produced an opaque spawn failure.
    #[test]
    fn wsl_is_offered_only_when_it_is_installed() {
        assert_eq!(ids(&available_shells(|_| false)), vec!["powershell", "cmd"]);
        assert_eq!(
            ids(&available_shells(|exe| exe == "wsl.exe")),
            vec!["powershell", "cmd", "wsl"]
        );
    }

    #[test]
    fn powershell_is_labelled_by_the_one_that_resolved() {
        let seven = available_shells(|exe| exe == "pwsh.exe");
        assert_eq!(seven[0].label, "PowerShell 7");
        let five = available_shells(|_| false);
        assert_eq!(five[0].label, "Windows PowerShell");
    }
}

#[cfg(not(target_os = "windows"))]
mod posix {
    use super::*;

    fn ids(all: &[ShellOption]) -> Vec<&str> {
        all.iter().map(|o| o.id.as_str()).collect()
    }

    /// With nothing installed the login shell is still offered — it is the one entry that resolves
    /// through `$SHELL` rather than a fixed path, so the picker is never empty.
    #[test]
    fn the_login_shell_is_always_offered() {
        assert_eq!(ids(&available_shells(|_| false)), vec!["default"]);
    }

    #[test]
    fn only_the_shells_that_resolve_are_offered() {
        let only_bash = available_shells(|p| p == "/bin/bash");
        assert_eq!(ids(&only_bash), vec!["default", "bash"]);
        assert_eq!(
            ids(&available_shells(|_| true)),
            vec!["default", "zsh", "bash", "sh"]
        );
    }
}

#[test]
fn command_returns_only_supported_shell_identifiers_without_duplicates() {
    let shells = tauri::async_runtime::block_on(list_available_shells());
    let mut ids = std::collections::HashSet::new();
    for shell in shells {
        assert!(["powershell", "cmd", "wsl", "bash", "zsh"].contains(&shell.id.as_str()));
        assert!(ids.insert(shell.id));
        assert!(!shell.label.trim().is_empty());
    }
}
