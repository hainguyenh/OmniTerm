//! Ad-hoc shell tests: the renderer payload contract, the pending-open queue, the in-memory
//! registry, and what a quick "new session" shell is allowed to be.

use super::*;
use crate::test_support;
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
fn workspace_shell_payload_preserves_workspace_identity() {
    let payload = renderer_connection_for_workspace("adhoc-1", &request(), Some("ws-1"));
    assert_eq!(payload["workspaceId"], json!("ws-1"));
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
fn quick_shell_workspace_folder_requires_exactly_one_real_root() {
    use crate::workspace::{Workspace, WorkspaceFolder};

    let folder = WorkspaceFolder {
        id: "folder#one".to_string(),
        name: "One".to_string(),
        path: "/one".to_string(),
    };
    let make = |folders| Workspace {
        id: "ws#one".to_string(),
        name: "One".to_string(),
        folders,
        parent_id: None,
        order: 0,
        pins: Vec::new(),
    };

    assert_eq!(
        quick_shell_workspace_folder(&make(Vec::new())).expect_err("empty workspace must fail"),
        "Add a folder to this workspace before opening a shell."
    );
    assert_eq!(
        quick_shell_workspace_folder(&make(vec![folder.clone(), folder.clone()]))
            .expect_err("multi-root workspace must be explicit"),
        "Choose a workspace folder before opening a shell."
    );
    assert_eq!(
        quick_shell_workspace_folder(&make(vec![folder]))
            .expect("single-root workspace is unambiguous")
            .id,
        "folder#one"
    );
}

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

#[test]
fn mock_runtime_covers_open_ready_release_and_direct_quick_shell_commands() {
    use tauri::Manager;

    let app = test_support::mock_app();
    assert!(app.manage(AdhocRegistry::new()));
    let handle = app.handle().clone();

    let queued_id = open_adhoc_shell(&handle, request());
    assert!(queued_id.starts_with("adhoc-"));
    assert!(app.state::<AdhocRegistry>().get(&queued_id).is_some());
    flush_pending(&handle);
    tauri::async_runtime::block_on(shells_ready(handle.clone())).unwrap();
    flush_pending(&handle);

    let payload = tauri::async_runtime::block_on(open_quick_shell(
        handle.clone(),
        Some(native_shell().to_string()),
        None,
    ))
    .unwrap();
    let direct_id = payload["id"].as_str().unwrap().to_string();
    assert_eq!(payload["type"], "LOCAL");
    assert!(app.state::<AdhocRegistry>().get(&direct_id).is_some());

    let named = "adhoc-named".to_string();
    app.state::<AdhocRegistry>()
        .insert_named(named.clone(), request());
    assert!(app.state::<AdhocRegistry>().get(&named).is_some());

    tauri::async_runtime::block_on(shells_release(handle.clone(), queued_id.clone())).unwrap();
    tauri::async_runtime::block_on(shells_release(handle.clone(), direct_id.clone())).unwrap();
    tauri::async_runtime::block_on(shells_release(handle, named.clone())).unwrap();
    assert!(app.state::<AdhocRegistry>().get(&queued_id).is_none());
    assert!(app.state::<AdhocRegistry>().get(&direct_id).is_none());
    assert!(app.state::<AdhocRegistry>().get(&named).is_none());
}
#[test]
fn poisoned_registry_lock_fails_closed_without_panicking() {
    use std::panic::{catch_unwind, AssertUnwindSafe};

    let registry = AdhocRegistry::new();
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let _guard = registry.conns.lock().unwrap();
        panic!("poison connection registry");
    }));

    assert!(registry.get("missing").is_none());
    registry.insert_named("ignored".to_string(), request());
    registry.remove("ignored");
    assert!(registry.get("ignored").is_none());
}

#[test]
fn poisoned_pending_queue_rejects_ready_and_drops_new_opens() {
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use tauri::Manager;

    let app = test_support::mock_app();
    assert!(app.manage(AdhocRegistry::new()));
    let registry = app.state::<AdhocRegistry>();
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let _guard = registry.pending.lock().unwrap();
        panic!("poison pending queue");
    }));

    let id = open_adhoc_shell(app.handle(), request());
    assert!(id.starts_with("adhoc-"));
    assert!(registry.get(&id).is_some());
    flush_pending(app.handle());

    let error = tauri::async_runtime::block_on(shells_ready(app.handle().clone())).unwrap_err();
    assert_eq!(error, "adhoc queue is poisoned");
}

#[test]
fn quick_shell_command_rejects_unsupported_renderer_input() {
    use tauri::Manager;

    let app = test_support::mock_app();
    assert!(app.manage(AdhocRegistry::new()));
    let result = tauri::async_runtime::block_on(open_quick_shell(
        app.handle().clone(),
        Some("../../evil".to_string()),
        None,
    ));
    assert!(result.is_err());
}

#[test]
fn quick_shell_with_workspace_and_queue_overflow_paths() {
    use tauri::Manager;
    use crate::workspace::{Workspace, WorkspaceFolder};

    let _guard = test_support::lock();
    let app = test_support::mock_app();
    assert!(app.manage(AdhocRegistry::new()));
    let handle = app.handle();

    let temp = tempfile::tempdir().unwrap();
    let valid_path = temp.path().to_string_lossy().into_owned();

    let ws_valid = Workspace {
        id: "ws#valid".to_string(),
        name: "Valid".to_string(),
        folders: vec![WorkspaceFolder { id: "f1".into(), name: "F1".into(), path: valid_path.clone() }],
        parent_id: None,
        order: 0,
        pins: Vec::new(),
    };
    let ws_empty = Workspace {
        id: "ws#empty".to_string(),
        name: "Empty".to_string(),
        folders: Vec::new(),
        parent_id: None,
        order: 1,
        pins: Vec::new(),
    };
    let ws_multi = Workspace {
        id: "ws#multi".to_string(),
        name: "Multi".to_string(),
        folders: vec![
            WorkspaceFolder { id: "f1".into(), name: "F1".into(), path: valid_path.clone() },
            WorkspaceFolder { id: "f2".into(), name: "F2".into(), path: valid_path.clone() },
        ],
        parent_id: None,
        order: 2,
        pins: Vec::new(),
    };
    let ws_bad_dir = Workspace {
        id: "ws#baddir".to_string(),
        name: "Bad".to_string(),
        folders: vec![WorkspaceFolder { id: "f1".into(), name: "F1".into(), path: "/missing/folder/nowhere".into() }],
        parent_id: None,
        order: 3,
        pins: Vec::new(),
    };

    let _ = crate::workspace_persistence::write_workspaces(handle, &[ws_valid, ws_empty, ws_multi, ws_bad_dir]);

    assert!(tauri::async_runtime::block_on(open_quick_shell(handle.clone(), None, Some("ws#ghost".into()))).unwrap_err().contains("Unknown workspace"));
    assert!(tauri::async_runtime::block_on(open_quick_shell(handle.clone(), None, Some("ws#empty".into()))).unwrap_err().contains("Add a folder"));
    assert!(tauri::async_runtime::block_on(open_quick_shell(handle.clone(), None, Some("ws#multi".into()))).unwrap_err().contains("Choose a workspace"));
    assert!(tauri::async_runtime::block_on(open_quick_shell(handle.clone(), None, Some("ws#baddir".into()))).unwrap_err().contains("invalid"));

    let res = tauri::async_runtime::block_on(open_quick_shell(handle.clone(), None, Some("ws#valid".into()))).unwrap();
    assert_eq!(res["localCwd"], valid_path);

    for _ in 0..MAX_PENDING_OPENS + 5 {
        open_adhoc_shell(handle, request());
    }

    if let Ok(path) = crate::workspace_persistence::workspaces_file(handle) {
        let _ = std::fs::remove_file(path);
    }
}

