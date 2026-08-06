//! Launch-resolution tests: which shell wins, and what argv each one produces.

use super::*;

#[allow(dead_code)] // used by the per-platform submodules below
fn launch(shell: LocalShell, command: Option<&str>, keep_open: bool) -> LocalLaunch {
    LocalLaunch {
        shell,
        cwd: None,
        args: None,
        command: command.map(str::to_owned),
        keep_open,
    }
}

// ── Merging saved / override params ──────────────────────────────────────────

#[test]
fn override_shell_wins_over_the_saved_one() {
    let native = if cfg!(target_os = "windows") { "cmd" } else { "sh" };
    let saved = if cfg!(target_os = "windows") { "powershell" } else { "bash" };
    let l = resolve_launch(Some(saved), Some(native), None, None, None, None).unwrap();
    assert_eq!(l.shell.as_str(), native);
}

#[test]
fn falls_back_to_the_saved_shell_then_to_default() {
    let saved = if cfg!(target_os = "windows") { "cmd" } else { "bash" };
    assert_eq!(
        resolve_launch(Some(saved), None, None, None, None, None)
            .unwrap()
            .shell
            .as_str(),
        saved
    );
    assert_eq!(
        resolve_launch(None, None, None, None, None, None).unwrap().shell,
        LocalShell::Default
    );
    // An empty override string is "no override", not "an unknown shell".
    assert_eq!(
        resolve_launch(Some(saved), Some(""), None, None, None, None)
            .unwrap()
            .shell
            .as_str(),
        saved
    );
}

/// The regression this guards: the first port's `resolve_shell` had a `_ => shell` arm, so any string
/// the webview (or `--open-shell` argv) supplied became the executable to spawn.
#[test]
fn an_unrecognized_shell_is_an_error_not_an_executable() {
    for hostile in ["C:\\evil.exe", "calc.exe", "/bin/evil", "powershell.exe"] {
        let err = resolve_launch(None, Some(hostile), None, None, None, None)
            .expect_err("must reject");
        assert!(err.contains("Unsupported shell"), "{hostile}: got {err}");
    }
}

#[test]
fn a_foreign_platform_shell_is_rejected() {
    let foreign = if cfg!(target_os = "windows") { "zsh" } else { "cmd" };
    let err =
        resolve_launch(Some(foreign), None, None, None, None, None).expect_err("must reject");
    assert!(err.contains("not available on this platform"), "got {err}");
}

#[test]
fn blank_optional_fields_normalize_to_none() {
    let l = resolve_launch(
        None,
        None,
        Some(String::new()),
        Some("   ".to_string()),
        Some("  ".to_string()),
        None,
    )
    .unwrap();
    assert_eq!(l.cwd, None);
    assert_eq!(l.args, None);
    assert_eq!(l.command, None);
}

#[test]
fn keep_open_defaults_to_true_when_absent() {
    assert!(resolve_launch(None, None, None, None, None, None).unwrap().keep_open);
    assert!(!resolve_launch(None, None, None, None, None, Some(false)).unwrap().keep_open);
}

// ── Windows argv ─────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod windows {
    use super::*;

    #[test]
    fn a_bare_shell_takes_no_extra_arguments() {
        let inv = launch(LocalShell::Cmd, None, true).invocation().unwrap();
        assert_eq!(inv.exe, "cmd.exe");
        assert!(inv.args.is_empty());
    }

    #[test]
    fn powershell_always_passes_nologo() {
        let inv = launch(LocalShell::Powershell, None, true).invocation().unwrap();
        assert_eq!(inv.args, vec!["-NoLogo"]);
    }

    /// `keepOpen` is the whole reason a script pane stays readable after it finishes.
    #[test]
    fn cmd_uses_k_to_stay_open_and_c_to_exit() {
        let stay = launch(LocalShell::Cmd, Some("build.bat"), true).invocation().unwrap();
        assert_eq!(stay.args, vec!["/k", "build.bat"]);
        let exit = launch(LocalShell::Cmd, Some("build.bat"), false).invocation().unwrap();
        assert_eq!(exit.args, vec!["/c", "build.bat"]);
    }

    #[test]
    fn powershell_adds_noexit_only_when_staying_open() {
        let stay = launch(LocalShell::Powershell, Some("& './x.ps1'"), true)
            .invocation()
            .unwrap();
        assert_eq!(stay.args, vec!["-NoLogo", "-NoExit", "-Command", "& './x.ps1'"]);
        let exit = launch(LocalShell::Powershell, Some("& './x.ps1'"), false)
            .invocation()
            .unwrap();
        assert_eq!(exit.args, vec!["-NoLogo", "-Command", "& './x.ps1'"]);
    }

    /// `default` resolves to the PowerShell executable, so it must get the PowerShell flags — not an
    /// empty argv that would drop the command on the floor.
    #[test]
    fn default_shell_behaves_like_powershell() {
        let inv = launch(LocalShell::Default, Some("echo hi"), false).invocation().unwrap();
        assert_eq!(inv.args, vec!["-NoLogo", "-Command", "echo hi"]);
    }

    /// Extra args go before the command switch so they still apply when a command is set.
    #[test]
    fn extra_args_precede_the_command_switch() {
        let mut l = launch(LocalShell::Cmd, Some("build.bat"), true);
        l.args = Some("/v:on".to_string());
        assert_eq!(l.invocation().unwrap().args, vec!["/v:on", "/k", "build.bat"]);

        let mut ps = launch(LocalShell::Powershell, Some("x"), true);
        ps.args = Some("-NoProfile".to_string());
        assert_eq!(
            ps.invocation().unwrap().args,
            vec!["-NoLogo", "-NoProfile", "-NoExit", "-Command", "x"]
        );
    }

    #[test]
    fn a_quoted_path_in_extra_args_stays_one_argument() {
        let mut l = launch(LocalShell::Cmd, None, true);
        l.args = Some(r#"/k "C:/Program Files/app/run.bat""#.to_string());
        assert_eq!(
            l.invocation().unwrap().args,
            vec!["/k", "C:/Program Files/app/run.bat"]
        );
    }

    #[test]
    fn wsl_takes_extra_args_verbatim_when_there_is_no_command() {
        let mut l = launch(LocalShell::Wsl, None, true);
        l.args = Some("-d Ubuntu".to_string());
        assert_eq!(l.invocation().unwrap().args, vec!["-d", "Ubuntu"]);
        assert_eq!(l.invocation().unwrap().exe, "wsl.exe");
    }

    /// The regression: WSL fell through to "extra args only", so the command was silently discarded
    /// and running a `.sh` from a workspace just opened an idle interactive distro shell.
    #[test]
    fn wsl_runs_a_command_through_bash_inside_the_distro() {
        let exit = launch(LocalShell::Wsl, Some("bash ./x.sh"), false)
            .invocation()
            .unwrap();
        assert_eq!(exit.args, vec!["--", "bash", "-lc", "bash ./x.sh"]);

        let stay = launch(LocalShell::Wsl, Some("bash ./x.sh"), true)
            .invocation()
            .unwrap();
        assert_eq!(
            stay.args,
            vec!["--", "bash", "-lc", "bash ./x.sh; exec bash -l"]
        );
    }

    /// Distro selection has to stay in front of `--`, or wsl.exe reads it as part of the command.
    #[test]
    fn wsl_extra_args_precede_the_command_separator() {
        let mut l = launch(LocalShell::Wsl, Some("make"), false);
        l.args = Some("-d Ubuntu".to_string());
        assert_eq!(
            l.invocation().unwrap().args,
            vec!["-d", "Ubuntu", "--", "bash", "-lc", "make"]
        );
    }

    #[test]
    fn an_unterminated_quote_in_extra_args_surfaces_as_an_error() {
        let mut l = launch(LocalShell::Cmd, None, true);
        l.args = Some(r#""oops"#.to_string());
        assert!(l.invocation().is_err());
    }
}


/// `windows_args` is ordinary platform-independent argv construction even though `invocation()`
/// selects it only on Windows. Exercise it directly on Linux CI so every shell arm and keep-open
/// branch remains covered instead of waiting for a Windows-only coverage job.
#[test]
fn windows_argv_builder_is_tested_on_every_platform() {
    let cmd_keep = launch(LocalShell::Cmd, None, true)
        .windows_args(vec!["/v:on".to_string()], Some("build.bat".to_string()));
    assert_eq!(cmd_keep, vec!["/v:on", "/k", "build.bat"]);
    let cmd_exit = launch(LocalShell::Cmd, None, false)
        .windows_args(Vec::new(), Some("build.bat".to_string()));
    assert_eq!(cmd_exit, vec!["/c", "build.bat"]);
    assert!(launch(LocalShell::Cmd, None, true)
        .windows_args(Vec::new(), None)
        .is_empty());

    let ps_keep = launch(LocalShell::Powershell, None, true)
        .windows_args(vec!["-NoProfile".to_string()], Some("echo hi".to_string()));
    assert_eq!(
        ps_keep,
        vec!["-NoLogo", "-NoProfile", "-NoExit", "-Command", "echo hi"]
    );
    let ps_exit = launch(LocalShell::Default, None, false)
        .windows_args(Vec::new(), Some("echo hi".to_string()));
    assert_eq!(ps_exit, vec!["-NoLogo", "-Command", "echo hi"]);
    assert_eq!(
        launch(LocalShell::Powershell, None, true).windows_args(Vec::new(), None),
        vec!["-NoLogo"]
    );

    let wsl_keep = launch(LocalShell::Wsl, None, true).windows_args(
        vec!["-d".to_string(), "Ubuntu".to_string()],
        Some("make".to_string()),
    );
    assert_eq!(
        wsl_keep,
        vec!["-d", "Ubuntu", "--", "bash", "-lc", "make; exec bash -l"]
    );
    let wsl_exit = launch(LocalShell::Wsl, None, false)
        .windows_args(Vec::new(), Some("make".to_string()));
    assert_eq!(wsl_exit, vec!["--", "bash", "-lc", "make"]);
    assert_eq!(
        launch(LocalShell::Wsl, None, true)
            .windows_args(vec!["-d".to_string(), "Debian".to_string()], None),
        vec!["-d", "Debian"]
    );

    assert_eq!(
        launch(LocalShell::Bash, None, true)
            .windows_args(vec!["--norc".to_string()], Some("ignored".to_string())),
        vec!["--norc"]
    );
}

// ── POSIX argv ───────────────────────────────────────────────────────────────

#[cfg(not(target_os = "windows"))]
mod posix {
    use super::*;

    #[test]
    fn always_starts_a_login_shell() {
        let args = posix_args("/bin/zsh", vec![], None, true);
        assert_eq!(args, vec!["-l"]);
    }

    #[test]
    fn a_command_runs_via_dash_c_after_the_login_flag() {
        let args = posix_args("/bin/zsh", vec![], Some("make".to_string()), false);
        assert_eq!(args, vec!["-l", "-c", "make"]);
    }

    /// Staying open re-execs the login shell so the pane is still usable afterward.
    #[test]
    fn keep_open_reexecs_the_login_shell() {
        let args = posix_args("/bin/zsh", vec![], Some("make".to_string()), true);
        assert_eq!(args, vec!["-l", "-c", "make; exec '/bin/zsh' -l"]);
    }

    #[test]
    fn a_shell_path_with_a_quote_is_escaped_in_the_reexec() {
        let args = posix_args("/bin/it's", vec![], Some("make".to_string()), true);
        assert_eq!(args[2], r"make; exec '/bin/it'\''s' -l");
    }

    #[test]
    fn extra_args_precede_the_login_flag() {
        let args = posix_args(
            "/bin/bash",
            vec!["--norc".to_string()],
            Some("make".to_string()),
            false,
        );
        assert_eq!(args, vec!["--norc", "-l", "-c", "make"]);
    }
}

#[test]
fn test_posix_args() {
    let args = super::posix_args("bash", vec!["-x".to_string()], Some("echo hello".to_string()), true);
    assert_eq!(args, vec!["-x", "-l", "-c", "echo hello; exec 'bash' -l"]);

    let args = super::posix_args("bash", vec![], Some("echo hello".to_string()), false);
    assert_eq!(args, vec!["-l", "-c", "echo hello"]);
}

#[test]
fn test_windows_args_fallthrough() {
    let launch = LocalLaunch {
        shell: LocalShell::Sh,
        cwd: None,
        args: Some("-x".to_string()),
        command: Some("echo hello".to_string()),
        keep_open: true,
    };
    let invocation = launch.invocation();
}
