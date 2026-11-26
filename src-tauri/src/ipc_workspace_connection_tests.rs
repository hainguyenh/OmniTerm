//! IPC contract for saving, editing and deleting a workspace's SSH / Remote Desktop profiles.

use super::IpcApp;
use serde_json::{json, Value};
use std::fs;

#[test]
fn ipc_saves_edits_and_deletes_a_workspace_connection_without_a_password() {
    let fixture = IpcApp::new();
    let workspace_dir = tempfile::tempdir().unwrap();
    let workspace = fixture.ok(
        "add_workspace",
        json!({ "path": workspace_dir.path().to_string_lossy() }),
    );
    let workspace_id = workspace["id"].as_str().expect("workspace id");
    let draft = json!({ "id": "", "name": "", "type": "SSH", "host": "10.0.0.5", "port": "2222", "user": "root", "password": "hunter2" });

    let saved = fixture.ok(
        "save_workspace_connection",
        json!({ "workspaceId": workspace_id, "connection": draft }),
    );
    let id = saved["id"].as_str().expect("saved id").to_string();
    assert_eq!(saved["name"], "root@10.0.0.5");
    let file = workspace_dir.path().join(".omniterm/connections.json");
    assert!(!fs::read_to_string(&file).unwrap().contains("hunter2"));

    let edited = json!({ "id": &id, "name": "box", "type": "SSH", "host": "box.test", "port": "", "user": "" });
    fixture.ok(
        "save_workspace_connection",
        json!({ "workspaceId": workspace_id, "connection": edited }),
    );
    let listed = fixture.ok(
        "load_workspace_connections",
        json!({ "workspaceId": workspace_id }),
    );
    assert_eq!(listed.as_array().map(Vec::len), Some(1));
    assert_eq!(listed[0]["host"], "box.test");

    let bad = json!({ "id": "", "name": "", "type": "SSH", "host": "-oProxyCommand=x", "port": "", "user": "" });
    assert!(fixture
        .invoke(
            "save_workspace_connection",
            json!({ "workspaceId": workspace_id, "connection": bad }),
        )
        .is_err());

    assert_eq!(
        fixture.ok(
            "delete_workspace_connection",
            json!({ "workspaceId": workspace_id, "connectionId": &id }),
        ),
        Value::Bool(true)
    );
    assert_eq!(
        fixture.ok(
            "load_workspace_connections",
            json!({ "workspaceId": workspace_id }),
        ),
        json!([])
    );
}
