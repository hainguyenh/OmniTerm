//! POSIX argv tests: split out of launch_tests.rs to keep it under the .rs line cap.

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
let args = super::posix_args(
    "bash",
    vec!["-x".to_string()],
    Some("echo hello".to_string()),
    true,
);
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
let _invocation = launch.invocation();
