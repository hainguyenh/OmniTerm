//! End-to-end IPC contract tests for quick shells opened in a chosen directory or workspace folder,
//! and the `shell-open` hand-off to a ready renderer.

use super::IpcApp;
use serde_json::{json, Value};
use std::fs;
use std::sync::mpsc::channel;
use tauri::Listener;

#[test]
fn ipc_quick_shells_start_only_in_real_directories() {
    let fixture = IpcApp::new();
    let root = tempfile::tempdir().expect("temp root");
    let file = root.path().join("notes.txt");
    fs::write(&file, "x").expect("a plain file");

    for cwd in [file.clone(), root.path().join("missing")] {
        assert_eq!(
            fixture.error(
                "open_quick_shell",
                json!({ "shell": null, "cwd": cwd.to_string_lossy() }),
            ),
            "Working directory is invalid."
        );
    }

    let opened = fixture.ok(
        "open_quick_shell",
        json!({ "shell": null, "cwd": root.path().to_string_lossy() }),
    );
    let cwd = opened["localCwd"].as_str().expect("cwd in the payload");
    assert_eq!(
        fs::canonicalize(cwd).expect("payload cwd exists"),
        fs::canonicalize(root.path()).expect("temp root exists")
    );
}

#[test]
fn ipc_quick_shells_resolve_a_workspace_folder_and_refuse_a_vanished_one() {
    let fixture = IpcApp::new();
    let root = tempfile::tempdir().expect("temp root");
    let folder = root.path().join("project");
    fs::create_dir_all(&folder).expect("workspace folder");
    let workspace = fixture.ok("add_workspace", json!({ "path": folder.to_string_lossy() }));
    let workspace_id = workspace["id"].as_str().expect("workspace id");

    let opened = fixture.ok(
        "open_quick_shell",
        json!({ "shell": null, "workspaceId": workspace_id }),
    );
    assert_eq!(opened["workspaceId"], workspace_id);

    assert_eq!(
        fixture.error(
            "open_quick_shell",
            json!({ "shell": null, "workspaceId": "ws#unknown" }),
        ),
        "Unknown workspace \"ws#unknown\"."
    );

    // The folder was replaced by a file after the workspace was saved.
    fs::remove_dir_all(&folder).expect("remove the folder");
    fs::write(&folder, "not a folder").expect("a file in its place");
    assert_eq!(
        fixture.error(
            "open_quick_shell",
            json!({ "shell": null, "workspaceId": workspace_id }),
        ),
        "Workspace folder is invalid."
    );
}

#[test]
fn ipc_queued_shells_reach_the_renderer_once_it_is_ready() {
    let fixture = IpcApp::new();
    let handle = fixture.handle();
    let (sender, receiver) = channel();
    fixture.app.listen_any("shell-open", move |event| {
        let payload: Value = serde_json::from_str(event.payload()).expect("JSON payload");
        let _ = sender.send(payload);
    });
    let request = || crate::adhoc::quick_shell_request(None).expect("the default shell");

    // A launch from another process arrives before the renderer listens: it waits in the queue.
    let queued = crate::adhoc::open_adhoc_shell(&handle, request());
    assert!(
        receiver.try_recv().is_err(),
        "nothing is emitted before ready"
    );

    assert_eq!(fixture.ok("shells_ready", json!({})), Value::Null);
    let delivered: Vec<Value> = receiver.try_iter().collect();
    assert_eq!(delivered.len(), 1, "{delivered:?}");
    assert_eq!(delivered[0]["id"], queued);

    // Once ready, the next launch is delivered as soon as it is registered.
    let direct = crate::adhoc::open_adhoc_shell(&handle, request());
    let delivered: Vec<Value> = receiver.try_iter().collect();
    assert_eq!(delivered.len(), 1, "{delivered:?}");
    assert_eq!(delivered[0]["id"], direct);
}
