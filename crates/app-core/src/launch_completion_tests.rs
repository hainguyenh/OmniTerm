//! Command-completion and cwd-hook argv tests: split out of launch_tests.rs to keep it under the
//! .rs line cap.

use super::*;

#[test]
fn command_completion_keeps_powershell_prediction_untouched() {
    let bare = launch(LocalShell::Powershell, None, true)
        .invocation_with_completion(true)
        .unwrap();
    assert_eq!(bare.args, interactive_ps_args(true));
    let stay = launch(LocalShell::Default, Some("x"), true)
        .invocation_with_completion(true)
        .unwrap();
    assert_eq!(
        stay.args.last().unwrap(),
        &format!("{}; x", powershell_interactive_bootstrap(true))
    );
}

#[test]
fn disabled_command_completion_turns_powershell_prediction_off() {
    let bare = launch(LocalShell::Powershell, None, true)
        .invocation_with_completion(false)
        .unwrap();
    assert_eq!(bare.args, interactive_ps_args(false));
}

#[test]
fn command_completion_does_not_change_cmd_argv() {
    let on = launch(LocalShell::Cmd, None, true)
        .invocation_with_completion(true)
        .unwrap();
    assert_eq!(on.args, vec!["/k", "chcp 65001 >nul"]);
}

/// A pwsh pane reports its folder after every `cd`: the prompt hook wraps the user's own prompt
/// and prepends the OSC 9;9 notification the renderer's cwd tracking listens for.
#[test]
fn interactive_powershell_reports_its_working_directory() {
    let bootstrap = powershell_interactive_bootstrap(false);
    assert!(bootstrap.starts_with(POWERSHELL_INTERACTIVE_BOOTSTRAP));
    assert!(bootstrap.contains("function global:prompt"));
    assert!(bootstrap.contains("& $global:__omnitermPrompt"));
    assert!(bootstrap.contains("']9;9;'"));
    assert!(!bootstrap.contains('"'), "the argv entry must not need quote escaping");
    assert!(powershell_interactive_bootstrap(true).starts_with(POWERSHELL_UTF8_BOOTSTRAP));
}
