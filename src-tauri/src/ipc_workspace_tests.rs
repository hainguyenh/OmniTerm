use super::{connection, IpcApp};
use serde_json::{json, Value};
use std::{fs, path::Path};

#[test]
fn ipc_manages_workspaces_and_workspace_connections() {
    let fixture = IpcApp::new();
    let workspace_dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(workspace_dir.path().join("scripts/tools")).unwrap();
    fs::create_dir_all(workspace_dir.path().join("node_modules/ignored")).unwrap();
    fs::write(workspace_dir.path().join("scripts/build.sh"), "echo before\n").unwrap();
    fs::write(workspace_dir.path().join("scripts/notes.txt"), "notes\n").unwrap();
    fs::write(
        workspace_dir.path().join("scripts/tools/deploy.ps1"),
        "Write-Output deploy\n",
    )
    .unwrap();
    fs::write(workspace_dir.path().join("notes.txt"), "hello\n").unwrap();

    let workspace = fixture.ok(
        "add_workspace",
        json!({ "path": workspace_dir.path().to_string_lossy() }),
    );
    let workspace_id = workspace["id"].as_str().expect("workspace id");
    assert_eq!(
        fixture.ok(
            "add_workspace",
            json!({ "path": workspace_dir.path().to_string_lossy() }),
        )["id"],
        workspace_id
    );
    assert_eq!(fixture.ok("list_workspaces", json!({})).as_array().unwrap().len(), 1);

    let scripts = fixture.ok("scan_scripts", json!({ "workspaceId": workspace_id }));
    assert!(scripts.as_array().is_some_and(|items| !items.is_empty()));
    let folders = fixture.ok(
        "scan_workspace_folders",
        json!({ "workspaceId": workspace_id }),
    );
    let folders = folders.as_array().expect("workspace folders array");
    let scripts_folder = folders
        .iter()
        .find(|item| item["id"] == "scripts")
        .expect("scripts folder");
    assert_eq!(scripts_folder["name"], "scripts");
    assert_eq!(scripts_folder["kind"], "dir");
    assert_eq!(scripts_folder["isDir"], true);
    let expected_scripts_path = workspace_dir.path().join("scripts");
    assert_eq!(
        scripts_folder["path"].as_str().map(Path::new),
        Some(expected_scripts_path.as_path())
    );
    assert!(folders.iter().any(|item| item["id"] == "scripts/tools"));
    assert!(!folders
        .iter()
        .any(|item| item["id"].as_str().is_some_and(|id| id.starts_with("node_modules"))));
    let entries = fixture.ok(
        "scan_workspace_entries",
        json!({
            "workspaceId": workspace_id,
            "folder": "scripts",
            "offset": 0,
            "limit": 20
        }),
    );
    assert_eq!(entries["entries"][0]["id"], "scripts/build.sh");
    assert_eq!(entries["total"], 2);
    assert_eq!(entries["hasMore"], false);

    let first_page = fixture.ok(
        "scan_workspace_entries",
        json!({
            "workspaceId": workspace_id,
            "folder": "scripts",
            "offset": 0,
            "limit": 1
        }),
    );
    assert_eq!(first_page["entries"].as_array().unwrap().len(), 1);
    assert_eq!(first_page["total"], 2);
    assert_eq!(first_page["hasMore"], true);
    let second_page = fixture.ok(
        "scan_workspace_entries",
        json!({
            "workspaceId": workspace_id,
            "folder": "scripts",
            "offset": 1,
            "limit": 1
        }),
    );
    assert_eq!(second_page["entries"].as_array().unwrap().len(), 1);
    assert_eq!(second_page["total"], 2);
    assert_eq!(second_page["hasMore"], false);

    assert_eq!(
        fixture
            .ok(
                "read_script",
                json!({ "workspaceId": workspace_id, "path": "scripts/build.sh" }),
            )
            .as_str(),
        Some("echo before\n")
    );
    assert_eq!(
        fixture.ok(
            "write_script",
            json!({
                "workspaceId": workspace_id,
                "path": "scripts/build.sh",
                "content": "echo after\n"
            }),
        ),
        Value::Null
    );
    assert_eq!(
        fixture
            .ok(
                "read_script",
                json!({ "workspaceId": workspace_id, "path": "scripts/build.sh" }),
            )
            .as_str(),
        Some("echo after\n")
    );

    assert_eq!(
        fixture.ok(
            "run_script",
            json!({ "workspaceId": workspace_id, "script": null, "subPath": "scripts" }),
        ),
        json!(true)
    );

    assert_eq!(
        fixture.ok(
            "load_workspace_connections",
            json!({ "workspaceId": workspace_id }),
        ),
        json!([])
    );
    assert_eq!(
        fixture.ok(
            "save_workspace_connections",
            json!({ "workspaceId": workspace_id, "data": [connection("workspace-ssh")] }),
        ),
        Value::Null
    );
    let saved = fixture.ok(
        "load_workspace_connections",
        json!({ "workspaceId": workspace_id }),
    );
    assert_eq!(saved[0]["id"], "workspace-ssh");
    assert_eq!(
        fixture.ok(
            "delete_workspace_connection",
            json!({ "workspaceId": workspace_id, "connectionId": "workspace-ssh" }),
        ),
        Value::Null
    );
    assert_eq!(
        fixture.ok(
            "remove_workspace",
            json!({ "id": workspace_id }),
        ),
        Value::Null
    );
    assert_eq!(fixture.ok("list_workspaces", json!({})), json!([]));
}

#[test]
fn ipc_rejects_operations_for_an_unknown_workspace() {
    let fixture = IpcApp::new();
    let unknown = "ws#missing";
    let requests = [
        ("scan_scripts", json!({ "workspaceId": unknown })),
        ("scan_workspace_folders", json!({ "workspaceId": unknown })),
        (
            "scan_workspace_entries",
            json!({
                "workspaceId": unknown,
                "folder": "",
                "offset": 0,
                "limit": 20
            }),
        ),
        (
            "run_script",
            json!({ "workspaceId": unknown, "script": null, "subPath": null }),
        ),
        (
            "read_script",
            json!({ "workspaceId": unknown, "path": "missing.txt" }),
        ),
        (
            "write_script",
            json!({
                "workspaceId": unknown,
                "path": "missing.sh",
                "content": "echo no"
            }),
        ),
        (
            "load_workspace_connections",
            json!({ "workspaceId": unknown }),
        ),
        (
            "save_workspace_connections",
            json!({ "workspaceId": unknown, "data": [] }),
        ),
        (
            "delete_workspace_connection",
            json!({ "workspaceId": unknown, "connectionId": "missing" }),
        ),
    ];

    for (command, body) in requests {
        let error = fixture.error(command, body);
        assert!(
            error.to_string().contains("Unknown workspace"),
            "{command} returned the wrong error: {error}"
        );
    }
}
