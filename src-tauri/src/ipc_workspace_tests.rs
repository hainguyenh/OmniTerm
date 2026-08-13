use super::{connection, IpcApp};
use serde_json::{json, Value};
use std::fs;

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
    let folder_id = workspace["folders"][0]["id"].as_str().expect("folder id").to_string();
    let scripts_path = format!("{folder_id}/scripts");
    let tools_path = format!("{folder_id}/scripts/tools");
    let build_path = format!("{folder_id}/scripts/build.sh");
    let notes_path = format!("{folder_id}/scripts/notes.txt");
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
        .find(|item| item["id"] == scripts_path)
        .expect("scripts folder");
    assert_eq!(scripts_folder["name"], "scripts");
    assert_eq!(scripts_folder["kind"], "dir");
    assert_eq!(scripts_folder["isDir"], true);
    assert_eq!(scripts_folder["path"], scripts_path);
    assert!(folders.iter().any(|item| item["id"] == tools_path));
    assert!(!folders
        .iter()
        .any(|item| item["id"].as_str().is_some_and(|id| id.starts_with("node_modules"))));
    let entries = fixture.ok(
        "scan_workspace_entries",
        json!({
            "workspaceId": workspace_id,
            "folder": &scripts_path,
            "offset": 0,
            "limit": 20
        }),
    );
    assert_eq!(entries["entries"][0]["id"], build_path);
    assert_eq!(entries["total"], 2);
    assert_eq!(entries["hasMore"], false);

    let first_page = fixture.ok(
        "scan_workspace_entries",
        json!({
            "workspaceId": workspace_id,
            "folder": &scripts_path,
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
            "folder": &scripts_path,
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
                json!({ "workspaceId": workspace_id, "path": &build_path }),
            )
            .as_str(),
        Some("echo before\n")
    );
    assert_eq!(
        fixture.ok(
            "write_script",
            json!({
                "workspaceId": workspace_id,
                "path": &build_path,
                "content": "echo after\n"
            }),
        ),
        Value::Null
    );
    assert_eq!(
        fixture
            .ok(
                "read_script",
                json!({ "workspaceId": workspace_id, "path": &build_path }),
            )
            .as_str(),
        Some("echo after\n")
    );

    assert_eq!(
        fixture.ok(
            "run_script",
            json!({ "workspaceId": workspace_id, "script": null, "subPath": &scripts_path }),
        ),
        json!(true)
    );
    assert_eq!(
        fixture.ok(
            "run_script",
            json!({
                "workspaceId": workspace_id,
                "script": {
                    "id": &build_path,
                    "name": "Build",
                    "path": &build_path,
                    "kind": "sh",
                    "editable": true,
                    "viewable": true
                },
                "subPath": null
            }),
        ),
        json!(true)
    );
    assert_eq!(
        fixture.ok(
            "run_script",
            json!({ "workspaceId": workspace_id, "script": null, "subPath": &folder_id }),
        ),
        json!(true)
    );
    assert!(fixture
        .invoke(
            "run_script",
            json!({
                "workspaceId": workspace_id,
                "script": {
                    "id": &notes_path,
                    "name": "Notes",
                    "path": &notes_path,
                    "kind": "txt"
                },
                "subPath": null
            }),
        )
        .is_err());

    fs::write(
        workspace_dir.path().join("scripts/remote.rdp"),
        "full address:s:host.test\n",
    )
    .unwrap();
    #[cfg(target_os = "linux")]
    assert!(fixture
        .invoke(
            "run_script",
            json!({
                "workspaceId": workspace_id,
                "script": {
                    "id": &remote_path,
                    "name": "Remote",
                    "path": &remote_path,
                    "kind": "rdp"
                },
                "subPath": null
            }),
        )
        .is_err());

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

#[test]
fn ipc_imports_composite_workspaces_and_persists_hierarchy_pins_and_order() {
    let fixture = IpcApp::new();
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    fs::write(first.path().join("pinned.txt"), "pin me").unwrap();

    let parent = fixture.ok(
        "add_workspace",
        json!({ "path": first.path().to_string_lossy() }),
    );
    let parent_id = parent["id"].as_str().expect("parent id");
    let parent_folder_id = parent["folders"][0]["id"].as_str().expect("folder id");
    let updated = fixture.ok(
        "add_workspace_folder",
        json!({ "workspaceId": parent_id, "path": second.path().to_string_lossy() }),
    );
    assert_eq!(updated["folders"].as_array().map(Vec::len), Some(2));

    let pinned = fixture.ok(
        "set_workspace_entry_pinned",
        json!({
            "workspaceId": parent_id,
            "folderId": parent_folder_id,
            "path": "pinned.txt",
            "pinned": true
        }),
    );
    assert_eq!(pinned["pins"][0]["folderId"], parent_folder_id);
    assert_eq!(pinned["pins"][0]["path"], "pinned.txt");

    let child = fixture.ok("create_workspace", json!({ "name": "Nested" }));
    let child_id = child["id"].as_str().expect("child id");
    let moved = fixture.ok(
        "move_workspace",
        json!({ "workspaceId": child_id, "parentId": parent_id, "index": 0 }),
    );
    let nested = moved
        .as_array()
        .and_then(|items| items.iter().find(|item| item["id"] == child_id))
        .expect("nested workspace");
    assert_eq!(nested["parentId"], parent_id);
    assert_eq!(nested["order"], 0);

    let import_root = tempfile::tempdir().unwrap();
    let imported_folder = import_root.path().join("project");
    fs::create_dir_all(&imported_folder).unwrap();
    let workspace_file = import_root.path().join("Team.workspace");
    fs::write(
        &workspace_file,
        serde_json::to_vec(&json!({
            "folders": [{ "name": "Project", "path": "project" }],
            "settings": { "editor.fontSize": 99 },
            "extensions": { "recommendations": ["ignored.extension"] }
        }))
        .unwrap(),
    )
    .unwrap();
    let imported = fixture.ok(
        "import_workspace_file",
        json!({ "path": workspace_file.to_string_lossy() }),
    );
    assert_eq!(imported["name"], "Team");
    assert_eq!(imported["folders"].as_array().map(Vec::len), Some(1));
    assert_eq!(imported["folders"][0]["name"], "Project");
    assert!(imported.get("settings").is_none());
}
