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
