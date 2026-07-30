//! Ad-hoc shell tests: the renderer payload contract, the pending-open queue, the in-memory
//! registry, and what a quick "new session" shell is allowed to be.

use super::*;
use crate::shell_spec::LocalShell;

fn request() -> OpenShellRequest {
    OpenShellRequest {
        shell: LocalShell::Powershell,
        cwd: Some("C:/proj".to_string()),
        command: Some("echo hi".to_string()),
        args: None,
        keep_open: true,
        name: "Deploy".to_string(),
    }
}

/// The renderer treats this payload as a `Connection` and reads `id`/`type` off it directly, so
/// the field names are a contract, not an implementation detail.
#[test]
fn payload_matches_the_renderer_connection_shape() {
    let payload = renderer_connection("adhoc-abc", &request());
    assert_eq!(payload["id"], json!("adhoc-abc"));
    assert_eq!(payload["type"], json!("LOCAL"));
    assert_eq!(payload["name"], json!("Deploy"));
    assert_eq!(payload["shell"], json!("powershell"));
    assert_eq!(payload["localCwd"], json!("C:/proj"));
    assert_eq!(payload["localCommand"], json!("echo hi"));
    assert_eq!(payload["localArgs"], json!(null));
    assert_eq!(payload["localKeepOpen"], json!(true));
    // SSH/RDP fields exist but are empty for a LOCAL pane.
    for field in ["host", "port", "user"] {
        assert_eq!(payload[field], json!(""), "{field} should be empty");
    }
}

#[test]
fn shell_is_emitted_as_its_wire_name_not_an_executable_path() {
    let payload = renderer_connection("adhoc-1", &request());
    assert_eq!(payload["shell"], json!("powershell"));
}

#[test]
fn queue_holds_payloads_until_the_renderer_is_ready() {
    let mut queue = PendingQueue::default();
    assert!(queue.push(json!({"id": "a"})));
    assert!(queue.push(json!({"id": "b"})));
    // Not ready yet: nothing may be emitted, and nothing may be lost.
    assert!(queue.drain_if_ready().is_empty());

    queue.mark_ready();
    let drained = queue.drain_if_ready();
    assert_eq!(drained.len(), 2);
    assert_eq!(drained[0]["id"], json!("a"));
    // Draining is destructive — a second flush must not replay the same opens.
    assert!(queue.drain_if_ready().is_empty());
}

#[test]
fn queue_is_bounded() {
    let mut queue = PendingQueue::default();
    for i in 0..MAX_PENDING_OPENS {
        assert!(queue.push(json!({"i": i})), "push {i} should fit");
    }
    assert!(
        !queue.push(json!({"i": "overflow"})),
        "queue must refuse to grow past its cap"
    );
    queue.mark_ready();
    assert_eq!(queue.drain_if_ready().len(), MAX_PENDING_OPENS);
}

#[test]
fn registry_stores_and_releases_launch_params() {
    let registry = AdhocRegistry::new();
    registry.insert("adhoc-1".to_string(), request());
    assert_eq!(registry.get("adhoc-1").unwrap().name, "Deploy");
    assert!(registry.get("adhoc-missing").is_none());

    registry.remove("adhoc-1");
    assert!(
        registry.get("adhoc-1").is_none(),
        "released params must not linger in memory"
    );
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
fn quick_shell_names_the_requested_shell_and_nothing_else() {
    let req = quick_shell_request(Some(native_shell())).expect("should build");
    assert_eq!(req.shell.as_str(), native_shell());
    assert_eq!(req.name, req.shell.default_name());
    // A quick shell is only ever a bare shell — no directory, command or extra args.
    assert_eq!((req.cwd, req.command, req.args), (None, None, None));
    assert!(req.keep_open);
}

#[test]
fn quick_shell_defaults_when_no_shell_is_named() {
    for absent in [None, Some("")] {
        let req = quick_shell_request(absent).expect("should default");
        assert_eq!(req.shell, LocalShell::Default);
    }
}

/// Same property `parse_open_shell_args` protects: an arbitrary executable name must not survive
/// the trip from the webview to the spawner.
#[test]
fn quick_shell_refuses_anything_outside_the_closed_set() {
    for hostile in [
        "C:\\Windows\\System32\\calc.exe",
        "powershell.exe",
        "sh -c curl evil",
        "POWERSHELL",
    ] {
        assert!(
            quick_shell_request(Some(hostile)).is_err(),
            "{hostile:?} must not produce a launch request"
        );
    }
}

#[test]
fn quick_shell_refuses_a_shell_that_cannot_exist_here() {
    let foreign = if cfg!(target_os = "windows") { "bash" } else { "cmd" };
    assert!(quick_shell_request(Some(foreign)).is_err());
}
