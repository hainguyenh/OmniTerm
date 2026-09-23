//! Command-completion argv tests: split out of launch_tests.rs to keep it under the .rs line cap.

use super::*;

#[test]
fn command_completion_keeps_powershell_prediction_untouched() {
    let bare = launch(LocalShell::Powershell, None, true)
        .invocation_with_completion(true)
        .unwrap();
    assert_eq!(
        bare.args,
        vec!["-NoLogo", "-NoExit", "-Command", POWERSHELL_UTF8_BOOTSTRAP]
    );
    let stay = launch(LocalShell::Default, Some("x"), true)
        .invocation_with_completion(true)
        .unwrap();
    assert_eq!(
        stay.args.last().unwrap(),
        &format!("{POWERSHELL_UTF8_BOOTSTRAP}; x")
    );
}

#[test]
fn disabled_command_completion_turns_powershell_prediction_off() {
    let bare = launch(LocalShell::Powershell, None, true)
        .invocation_with_completion(false)
        .unwrap();
    assert_eq!(
        bare.args,
        vec!["-NoLogo", "-NoExit", "-Command", POWERSHELL_INTERACTIVE_BOOTSTRAP]
    );
}

#[test]
fn command_completion_does_not_change_cmd_argv() {
    let on = launch(LocalShell::Cmd, None, true)
        .invocation_with_completion(true)
        .unwrap();
    assert_eq!(on.args, vec!["/k", "chcp 65001 >nul"]);
}
