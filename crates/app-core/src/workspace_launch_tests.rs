//! How each script kind is handed to a shell.

use super::*;

/// A script pane closes when the script finishes — `keepOpen: false`, per Electron. The first port
/// hard-coded `keepOpen: true` for every workspace launch.
#[test]
fn a_script_run_does_not_keep_the_pane_open() {
    let req = script_run_request("bat", "C:/p/deploy.bat", "deploy.bat", "C:/p");
    assert!(!req.keep_open);
    assert_eq!(req.name, "deploy.bat");
    assert_eq!(req.cwd.as_deref(), Some("C:/p"));
}

/// The script path belongs in `command`, not in `shell`. The first port put it in the shell slot, so
/// the launcher tried to spawn the .bat file itself as the shell executable.
#[test]
fn the_script_path_goes_in_the_command_not_the_shell() {
    let req = script_run_request("bat", "C:/p/deploy.bat", "deploy.bat", "C:/p");
    assert!(req.command.unwrap().contains("deploy.bat"));
    assert!(LocalShell::parse(req.shell.as_str()).is_some());
}

#[cfg(target_os = "windows")]
#[test]
fn each_kind_routes_to_the_right_windows_shell() {
    // Deliberately unquoted: this string becomes one argv entry and the spawner quotes it. Adding
    // quotes here made cmd.exe reject the path — see the comment on `script_run_request`.
    let bat = script_run_request("bat", r"D:\my p\x.bat", "x.bat", r"D:\my p");
    assert_eq!(bat.shell, LocalShell::Cmd);
    assert_eq!(bat.command.as_deref(), Some(r"D:\my p\x.bat"));

    let ps1 = script_run_request("ps1", "C:/p/x.ps1", "x.ps1", "C:/p");
    assert_eq!(ps1.shell, LocalShell::Powershell);
    assert_eq!(ps1.command.as_deref(), Some("& 'C:/p/x.ps1'"));

    // .sh on Windows runs through WSL, and the Windows path must be translated for the distro —
    // handing `D:\ws\x.sh` straight to WSL bash is a "No such file or directory".
    let sh = script_run_request("sh", r"D:\p\x.sh", "x.sh", r"D:\p");
    assert_eq!(sh.shell, LocalShell::Wsl);
    assert_eq!(
        sh.command.as_deref(),
        Some(r#"bash "$(wslpath -a 'D:\p\x.sh')""#)
    );
}

#[cfg(not(target_os = "windows"))]
#[test]
fn posix_runs_every_kind_through_the_login_shell() {
    for kind in ["bat", "ps1", "sh"] {
        let req = script_run_request(kind, "/p/x", "x", "/p");
        assert_eq!(req.shell, LocalShell::Default);
        assert_eq!(req.command.as_deref(), Some(r#"sh "/p/x""#));
    }
}

#[test]
fn the_default_shell_for_a_plain_terminal_is_valid_here() {
    assert!(default_shell().is_supported_here());
}
