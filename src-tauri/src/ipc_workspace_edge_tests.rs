use super::IpcApp;
use serde_json::json;
use std::fs;

#[test]
fn ipc_rejects_workspace_paths_that_escape_the_root() {
    let fixture = IpcApp::new();
    let root = tempfile::tempdir().unwrap();
    let project = root.path().join("project");
    fs::create_dir_all(project.join("scripts")).unwrap();
    fs::write(project.join("scripts/build.sh"), b"echo safe\n").unwrap();
    fs::write(root.path().join("outside.sh"), b"echo outside\n").unwrap();

    let workspace = fixture.ok(
        "add_workspace",
        json!({ "path": project.to_string_lossy() }),
    );
    let workspace_id = workspace["id"].as_str().expect("workspace id");
    let folder_id = workspace["folders"][0]["id"].as_str().expect("folder id").to_string();
    let escape = format!("{folder_id}/../outside.sh");

    assert!(fixture
        .invoke(
            "scan_workspace_entries",
            json!({
                "workspaceId": workspace_id,
                "folder": format!("{folder_id}/.."),
                "offset": 0,
                "limit": 20
            }),
        )
        .is_err());
    assert!(fixture
        .invoke(
            "read_script",
            json!({ "workspaceId": workspace_id, "path": &escape }),
        )
        .is_err());
    assert!(fixture
        .invoke(
            "write_script",
            json!({
                "workspaceId": workspace_id,
                "path": &escape,
                "content": "overwritten"
            }),
        )
        .is_err());
    assert!(fixture
        .invoke(
            "run_script",
            json!({
                "workspaceId": workspace_id,
                "script": {
                    "id": &escape,
                    "name": "Outside",
                    "path": &escape,
                    "kind": "sh"
                },
                "subPath": null
            }),
        )
        .is_err());
    assert_eq!(
        fs::read(root.path().join("outside.sh")).unwrap(),
        b"echo outside\n"
    );
}

#[test]
fn ipc_reports_a_workspace_root_deleted_after_registration() {
    let fixture = IpcApp::new();
    let root = tempfile::tempdir().unwrap();
    let project = root.path().join("project");
    fs::create_dir_all(&project).unwrap();

    let workspace = fixture.ok(
        "add_workspace",
        json!({ "path": project.to_string_lossy() }),
    );
    let workspace_id = workspace["id"].as_str().expect("workspace id");
    let folder_id = workspace["folders"][0]["id"].as_str().expect("folder id").to_string();
    fs::remove_dir_all(&project).unwrap();

    assert_eq!(fixture.ok("scan_scripts", json!({ "workspaceId": workspace_id })), json!([]));
    let folders = fixture.ok("scan_workspace_folders", json!({ "workspaceId": workspace_id }));
    assert_eq!(folders.as_array().map(Vec::len), Some(1));
    assert!(fixture
        .invoke(
            "scan_workspace_entries",
            json!({
                "workspaceId": workspace_id,
                "folder": &folder_id,
                "offset": 0,
                "limit": 20
            }),
        )
        .is_err());
}

#[test]
fn ipc_workspace_mutations_and_connection_scoping_edge_cases() {
    let fixture = IpcApp::new();
    let root1 = tempfile::tempdir().unwrap();
    let root2 = tempfile::tempdir().unwrap();
    fs::create_dir_all(root1.path().join("scripts")).unwrap();

    let created = fixture.ok("create_workspace", json!({ "name": "Initial" }));
    let ws_id = created["id"].as_str().unwrap();

    assert!(fixture.invoke("rename_workspace", json!({ "workspaceId": ws_id, "name": "" })).is_err());
    assert!(fixture.invoke("rename_workspace", json!({ "workspaceId": "ws#ghost", "name": "Ghost" })).is_err());

    let renamed = fixture.ok("rename_workspace", json!({ "workspaceId": ws_id, "name": "Renamed" }));
    assert_eq!(renamed["name"], "Renamed");

    assert!(fixture.invoke("save_workspace_connections", json!({
        "workspaceId": ws_id,
        "data": [{ "id": "c1", "name": "c1", "type": "SSH", "host": "1.2.3.4", "port": "22", "user": "root" }]
    })).unwrap_err().to_string().contains("Add a folder"));

    let with_folder = fixture.ok("add_workspace_folder", json!({ "workspaceId": ws_id, "path": root1.path().to_string_lossy() }));
    let f1_id = with_folder["folders"][0]["id"].as_str().unwrap().to_string();

    let pinned = fixture.ok("set_workspace_entry_pinned", json!({
        "workspaceId": ws_id,
        "folderId": &f1_id,
        "path": "scripts",
        "pinned": true
    }));
    assert_eq!(pinned["pins"].as_array().unwrap().len(), 1);

    let unpinned = fixture.ok("set_workspace_entry_pinned", json!({
        "workspaceId": ws_id,
        "folderId": &f1_id,
        "path": "scripts",
        "pinned": false
    }));
    assert!(unpinned["pins"].as_array().unwrap().is_empty());

    assert!(fixture.invoke("set_workspace_entry_pinned", json!({
        "workspaceId": ws_id,
        "folderId": "folder#ghost",
        "path": "scripts",
        "pinned": true
    })).is_err());

    let with_two = fixture.ok("add_workspace_folder", json!({ "workspaceId": ws_id, "path": root2.path().to_string_lossy() }));
    let f2_id = with_two["folders"][1]["id"].as_str().unwrap().to_string();

    let unparented = json!({ "id": "c_unparented", "name": "c", "type": "SSH", "host": "1.2.3.4", "port": "22", "user": "root" });
    assert!(fixture.invoke("save_workspace_connections", json!({ "workspaceId": ws_id, "data": [unparented] })).unwrap_err().to_string().contains("Choose a workspace folder"));

    let bad_parent = json!({ "id": "c_bad", "name": "c", "type": "SSH", "host": "1.2.3.4", "port": "22", "user": "root", "parentId": "folder#ghost/sub" });
    assert!(fixture.invoke("save_workspace_connections", json!({ "workspaceId": ws_id, "data": [bad_parent] })).is_err());

    let c_f1 = json!({ "id": "c1", "name": "c1", "type": "SSH", "host": "1.2.3.4", "port": "22", "user": "root", "parentId": format!("{f1_id}/group") });
    let c_f2 = json!({ "id": "c2", "name": "c2", "type": "SSH", "host": "1.2.3.4", "port": "22", "user": "root", "parentId": format!("{f2_id}/servers") });
    fixture.ok("save_workspace_connections", json!({ "workspaceId": ws_id, "data": [c_f1, c_f2] }));

    let loaded = fixture.ok("load_workspace_connections", json!({ "workspaceId": ws_id }));
    assert_eq!(loaded.as_array().unwrap().len(), 2);

    fixture.ok("delete_workspace_connection", json!({ "workspaceId": ws_id, "connectionId": "c2" }));
    let remaining = fixture.ok("load_workspace_connections", json!({ "workspaceId": ws_id }));
    assert_eq!(remaining.as_array().unwrap().len(), 1);
    assert_eq!(remaining[0]["id"], "c1");

    fixture.ok("delete_workspace_connection", json!({ "workspaceId": ws_id, "connectionId": "c_ghost" }));

    assert!(fixture.invoke("run_script", json!({ "workspaceId": ws_id, "script": null, "subPath": null })).unwrap_err().to_string().contains("Choose a workspace folder"));
}

