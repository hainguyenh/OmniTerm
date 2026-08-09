//! Shell allowlist, resolution, and arg-splitting tests.

use super::*;

// ── The allowlist ────────────────────────────────────────────────────────────

#[test]
fn parses_every_known_shell() {
    for name in ["wsl", "powershell", "cmd", "bash", "sh", "zsh", "default"] {
        let parsed = LocalShell::parse(name).expect("known shell should parse");
        assert_eq!(parsed.as_str(), name);
    }
}

#[test]
fn empty_string_is_the_platform_default() {
    assert_eq!(LocalShell::parse(""), Some(LocalShell::Default));
}

/// The security property: an arbitrary executable must never resolve to a shell. Without this,
/// `--open-shell C:\evil.exe` — writable by any local process — reaches `spawn_command`.
#[test]
fn rejects_arbitrary_executables() {
    for hostile in [
        "C:\\Windows\\System32\\calc.exe",
        "calc.exe",
        "/bin/evil",
        "powershell.exe",
        "POWERSHELL",
        "Cmd",
        "cmd /c del",
        "cmd.exe",
        "../../evil",
        "bash;rm -rf /",
        "bash ",
        " bash",
    ] {
        assert!(
            LocalShell::parse(hostile).is_none(),
            "{hostile:?} must not parse as a shell"
        );
    }
}

#[test]
fn platform_support_is_mutually_exclusive() {
    for s in [LocalShell::Wsl, LocalShell::Powershell, LocalShell::Cmd] {
        assert_eq!(s.is_supported_here(), cfg!(target_os = "windows"));
    }
    for s in [LocalShell::Bash, LocalShell::Sh, LocalShell::Zsh] {
        assert_eq!(s.is_supported_here(), !cfg!(target_os = "windows"));
    }
    // `default` means "whatever this platform runs" and is always available.
    assert!(LocalShell::Default.is_supported_here());
}

#[test]
fn refuses_to_resolve_a_shell_from_the_other_platform() {
    let foreign = if cfg!(target_os = "windows") {
        LocalShell::Bash
    } else {
        LocalShell::Cmd
    };
    let err = foreign.resolve_exe().expect_err("must not resolve");
    assert!(err.contains("not available on this platform"), "got {err}");
}

#[test]
fn the_platform_default_always_resolves() {
    let exe = LocalShell::Default
        .resolve_exe()
        .expect("the default shell must resolve on a working machine");
    assert!(!exe.is_empty());
}

/// Serde round-trips through the lowercase wire names the renderer and connections.json use.
#[test]
fn serializes_as_its_wire_name() {
    let json = serde_json::to_string(&LocalShell::Powershell).unwrap();
    assert_eq!(json, r#""powershell""#);
    assert_eq!(
        serde_json::from_str::<LocalShell>(r#""cmd""#).unwrap(),
        LocalShell::Cmd
    );
    assert!(serde_json::from_str::<LocalShell>(r#""calc.exe""#).is_err());
}

// ── Windows resolution ───────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
#[test]
fn windows_shells_resolve_to_expected_executables() {
    assert_eq!(LocalShell::Cmd.resolve_exe().unwrap(), "cmd.exe");
    assert_eq!(LocalShell::Wsl.resolve_exe().unwrap(), "wsl.exe");
    let ps = LocalShell::Powershell.resolve_exe().unwrap();
    assert!(ps == "pwsh.exe" || ps == "powershell.exe", "got {ps}");
    // `default` and `powershell` must agree, or a saved 'default' connection would switch shells
    // depending on which code path resolved it.
    assert_eq!(LocalShell::Default.resolve_exe().unwrap(), ps);
}

// ── POSIX resolution ─────────────────────────────────────────────────────────

#[cfg(not(target_os = "windows"))]
mod posix {
    use super::*;

    #[test]
    fn named_shell_resolves_to_bin_path_when_executable() {
        let exe = resolve_posix_shell(LocalShell::Bash, |p| p == "/bin/bash").unwrap();
        assert_eq!(exe, "/bin/bash");
    }

    #[test]
    fn named_shell_errors_when_not_installed() {
        let err = resolve_posix_shell(LocalShell::Zsh, |_| false).expect_err("must error");
        assert!(err.contains("/bin/zsh is not installed"), "got {err}");
    }

    #[test]
    fn default_prefers_zsh_then_falls_back_to_bash() {
        let _guard = crate::test_support::lock();
        let previous = std::env::var_os("SHELL");
        std::env::remove_var("SHELL");
        assert_eq!(
            resolve_posix_shell(LocalShell::Default, |p| p == "/bin/zsh").unwrap(),
            "/bin/zsh"
        );
        assert_eq!(
            resolve_posix_shell(LocalShell::Default, |p| p == "/bin/bash").unwrap(),
            "/bin/bash"
        );
        if let Some(val) = previous {
            std::env::set_var("SHELL", val);
        }
    }

    #[test]
    fn default_honors_an_executable_shell_env_var() {
        let _guard = crate::test_support::lock();
        let previous = std::env::var_os("SHELL");
        std::env::set_var("SHELL", "/usr/local/bin/fish");
        let exe = resolve_posix_shell(LocalShell::Default, |p| p == "/usr/local/bin/fish").unwrap();
        assert_eq!(exe, "/usr/local/bin/fish");
        if let Some(val) = previous {
            std::env::set_var("SHELL", val);
        } else {
            std::env::remove_var("SHELL");
        }
    }

    /// A non-executable or relative `$SHELL` must not be spawned — fall back to the known-good list.
    #[test]
    fn default_ignores_an_unusable_shell_env_var() {
        let _guard = crate::test_support::lock();
        let previous = std::env::var_os("SHELL");
        std::env::set_var("SHELL", "not/absolute");
        let exe = resolve_posix_shell(LocalShell::Default, |p| p == "/bin/zsh").unwrap();
        assert_eq!(exe, "/bin/zsh");
        if let Some(val) = previous {
            std::env::set_var("SHELL", val);
        } else {
            std::env::remove_var("SHELL");
        }
    }
}

// ── Argument splitting ───────────────────────────────────────────────────────

fn split(input: &str) -> Vec<String> {
    split_args(input).expect("should split")
}

#[test]
fn splits_plain_arguments() {
    assert_eq!(split("-l -a"), vec!["-l", "-a"]);
    assert_eq!(split("  spaced   out  "), vec!["spaced", "out"]);
    assert_eq!(split(""), Vec::<String>::new());
    assert_eq!(split("   "), Vec::<String>::new());
}

/// The regression this replaces: `split_whitespace` tore quoted Windows paths into pieces, so
/// `-File "C:\Program Files\x.ps1"` reached the shell as three broken arguments.
#[test]
fn keeps_quoted_paths_intact() {
    assert_eq!(
        split(r#"-File "C:/Program Files/app/x.ps1" -Verbose"#),
        vec!["-File", "C:/Program Files/app/x.ps1", "-Verbose"]
    );
}

#[test]
fn honors_single_quotes() {
    assert_eq!(split("-c 'echo one two'"), vec!["-c", "echo one two"]);
}

/// POSIX rules: a backslash escapes the next character, except inside single quotes.
#[test]
fn backslash_escapes_when_posix_rules_apply() {
    let split_posix = |s: &str| split_args_with(s, true).expect("should split");
    assert_eq!(split_posix(r"a\ b"), vec!["a b"]);
    assert_eq!(split_posix(r#""say \"hi\"""#), vec![r#"say "hi""#]);
    assert_eq!(split_posix(r"'a\b'"), vec![r"a\b"]);
    // A trailing backslash has nothing to escape and is kept.
    assert_eq!(split_posix(r"a\"), vec![r"a\"]);
}

/// On Windows a backslash is a path separator, not an escape. Applying POSIX rules there would
/// rewrite `-File C:\dir\x.ps1` into `C:dirx.ps1` and hand the shell a path that does not exist.
#[test]
fn a_windows_path_survives_intact() {
    let split_win = |s: &str| split_args_with(s, false).expect("should split");
    assert_eq!(
        split_win(r"-File C:\dir\sub\x.ps1"),
        vec!["-File", r"C:\dir\sub\x.ps1"]
    );
    assert_eq!(split_win(r"C:\dir\"), vec![r"C:\dir\"]);
    // Quoting still groups, so a spaced path is one argument.
    assert_eq!(
        split_win(r#"-File "C:\Program Files\x.ps1""#),
        vec!["-File", r"C:\Program Files\x.ps1"]
    );
}

/// `split_args` picks the rule from the target platform.
#[test]
fn the_platform_default_uses_the_right_escaping_rule() {
    let out = split(r"C:\dir\x");
    if cfg!(target_os = "windows") {
        assert_eq!(out, vec![r"C:\dir\x"]);
    } else {
        assert_eq!(out, vec!["C:dirx"]);
    }
}

#[test]
fn quotes_may_open_mid_token() {
    assert_eq!(split(r#"--cwd="C:/a b" -x"#), vec!["--cwd=C:/a b", "-x"]);
}

#[test]
fn an_empty_quoted_string_is_a_real_argument() {
    assert_eq!(split(r#"-m "" -n"#), vec!["-m", "", "-n"]);
}

/// Silently mis-splitting an unterminated quote would hand the shell a different command than the
/// user wrote; Electron threw here, so we error too.
#[test]
fn an_unterminated_quote_is_an_error() {
    let err = split_args(r#"-c "echo hi"#).expect_err("must error");
    assert!(err.contains("Unterminated quote"), "got {err}");
    assert!(split_args("'oops").is_err());
}

// ── Shell quoting ────────────────────────────────────────────────────────────

#[test]
fn shell_quote_wraps_and_escapes_single_quotes() {
    assert_eq!(shell_quote("/bin/zsh"), "'/bin/zsh'");
    assert_eq!(shell_quote("it's"), r"'it'\''s'");
}

#[test]
fn is_on_path_finds_nothing_for_a_bogus_executable() {
    assert!(!is_on_path("omniterm-definitely-not-a-real-binary.exe"));
}

// ── Shell labels and default names ───────────────────────────────────────────

#[test]
fn label_returns_human_readable_string_for_all_variants() {
    assert_eq!(LocalShell::Powershell.label(), "PowerShell");
    assert_eq!(LocalShell::Cmd.label(), "Command Prompt");
    assert_eq!(LocalShell::Wsl.label(), "WSL");
    assert_eq!(LocalShell::Default.label(), "Default shell");
    assert_eq!(LocalShell::Zsh.label(), "Z shell");
    assert_eq!(LocalShell::Bash.label(), "Bash");
    assert_eq!(LocalShell::Sh.label(), "POSIX shell");
}

#[test]
fn default_name_returns_expected_string_for_all_variants() {
    assert_eq!(LocalShell::Powershell.default_name(), "PowerShell");
    assert_eq!(LocalShell::Cmd.default_name(), "Command Prompt");
    assert_eq!(LocalShell::Wsl.default_name(), "WSL");
    // Non-Windows-specific shells delegate to label()
    assert_eq!(LocalShell::Default.default_name(), LocalShell::Default.label());
    assert_eq!(LocalShell::Zsh.default_name(), LocalShell::Zsh.label());
    assert_eq!(LocalShell::Bash.default_name(), LocalShell::Bash.label());
    assert_eq!(LocalShell::Sh.default_name(), LocalShell::Sh.label());
}

#[cfg(not(target_os = "windows"))]
#[test]
fn executable_and_path_probes_cover_positive_empty_and_missing_environment_cases() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::test_support::lock();
    let dir = tempfile::tempdir().unwrap();
    let executable = dir.path().join("omniterm-probe");
    std::fs::write(&executable, b"#!/bin/sh\nexit 0\n").unwrap();
    let mut permissions = std::fs::metadata(&executable).unwrap().permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(&executable, permissions).unwrap();

    assert!(is_executable(&executable));
    assert!(!is_executable(Path::new("relative-probe")));
    let ordinary = dir.path().join("ordinary");
    std::fs::write(&ordinary, b"not executable").unwrap();
    assert!(!is_executable(&ordinary));
    assert!(!is_executable(&dir.path().join("missing")));

    let previous = std::env::var_os("PATH");
    std::env::set_var("PATH", std::env::join_paths([Path::new(""), dir.path()]).unwrap());
    assert!(is_on_path("omniterm-probe"));
    std::env::remove_var("PATH");
    assert!(!is_on_path("omniterm-probe"));
    if let Some(previous) = previous {
        std::env::set_var("PATH", previous);
    }
}
