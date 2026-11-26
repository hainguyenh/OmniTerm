//! Argv tests that run on every platform: split out of launch_tests.rs to keep it under the .rs
//! line cap.

use super::*;

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
}
