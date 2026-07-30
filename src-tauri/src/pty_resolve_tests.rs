//! Which saved connection a pane is allowed to launch from.
//!
//! The webview supplies the connection id, so these are the checks standing between "the user picked
//! a saved shell" and "an id we do not recognize started a process".

use super::*;

/// Build a tree from JSON, so a case only names the fields it cares about — `Connection` has a dozen
/// optional ones and a literal would bury the property under boilerplate.
fn tree(connections: serde_json::Value) -> connections::ConnectionTree {
    serde_json::from_value(serde_json::json!({ "connections": connections, "folders": [] }))
        .expect("fixture should deserialize")
}

/// The shell this platform accepts, so the suite runs on both Windows and POSIX.
fn native_shell() -> &'static str {
    if cfg!(target_os = "windows") {
        "powershell"
    } else {
        "bash"
    }
}

#[test]
fn resolves_a_saved_local_connection() {
    let t = tree(serde_json::json!([{
        "id": "c1", "name": "Build", "type": "LOCAL", "shell": native_shell(),
        "localCwd": "C:/proj", "localCommand": "echo hi", "localKeepOpen": false,
    }]));
    let launch = launch_from_tree(t, "c1", None).expect("should resolve");
    assert_eq!(launch.shell.as_str(), native_shell());
    assert_eq!(launch.cwd.as_deref(), Some("C:/proj"));
    assert_eq!(launch.command.as_deref(), Some("echo hi"));
    assert!(!launch.keep_open);
}

/// The bug this guards: the "new session" button used to invent an id (`local-default-<ts>`) that was
/// never registered anywhere, so this lookup failed and the pane hung on "connecting". Unknown ids
/// must still fail here — the fix was to register the shell first, not to launch on a stranger's word.
#[test]
fn refuses_an_unknown_connection_id() {
    let err = launch_from_tree(tree(serde_json::json!([])), "local-default-123", None)
        .expect_err("an unknown id must not launch");
    assert!(err.contains("local-default-123"), "got {err:?}");
}

/// An override shell does not rescue an unknown id: honoring it would put the choice of what to spawn
/// back in the webview.
#[test]
fn an_override_shell_does_not_rescue_an_unknown_id() {
    assert!(launch_from_tree(
        tree(serde_json::json!([])),
        "local-default-123",
        Some(native_shell().to_string()),
    )
    .is_err());
}

#[test]
fn refuses_a_connection_that_is_not_local() {
    for remote in ["SSH", "RDP"] {
        let t = tree(serde_json::json!([{
            "id": "r1", "name": "prod", "type": remote, "host": "10.0.0.1",
        }]));
        let err = launch_from_tree(t, "r1", Some(native_shell().to_string()))
            .expect_err("{remote} must not open a local pane");
        assert_eq!(err, "Not a local connection.");
    }
}

/// A LOCAL record with no shell of its own falls back to the platform default rather than failing —
/// `shell` is optional in connections.json.
#[test]
fn a_local_connection_without_a_shell_uses_the_default() {
    let t = tree(serde_json::json!([{ "id": "c2", "name": "Shell", "type": "LOCAL" }]));
    let launch = launch_from_tree(t, "c2", None).expect("should resolve");
    assert_eq!(launch.shell, crate::shell_spec::LocalShell::Default);
}

#[test]
fn an_override_shell_wins_over_the_saved_one() {
    let t = tree(serde_json::json!([{
        "id": "c3", "name": "Shell", "type": "LOCAL", "shell": native_shell(),
    }]));
    let other = if cfg!(target_os = "windows") { "cmd" } else { "sh" };
    let launch = launch_from_tree(t, "c3", Some(other.to_string())).expect("should resolve");
    assert_eq!(launch.shell.as_str(), other);
}
