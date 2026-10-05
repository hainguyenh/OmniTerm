use super::IpcApp;
use serde_json::json;
use std::fs;

#[test]
fn ipc_text_file_round_trip_uses_camel_case_and_tagged_outcomes() {
    let fixture = IpcApp::new();
    let root = tempfile::tempdir().expect("temp root");
    let project = root.path().join("project");
    fs::create_dir_all(&project).expect("create project");
    fs::write(project.join("data.json"), b"\xEF\xBB\xBF{\"a\":1}\n").expect("write json");
    fs::write(root.path().join("outside.json"), b"{}").expect("write outside");

    let workspace = fixture.ok(
        "add_workspace",
        json!({ "path": project.to_string_lossy() }),
    );
    let workspace_id = workspace["id"].as_str().expect("workspace id");
    let folder_id = workspace["folders"][0]["id"].as_str().expect("folder id");
    let path = format!("{folder_id}/data.json");

    let opened = fixture.ok(
        "open_text_file",
        json!({ "workspaceId": workspace_id, "path": &path }),
    );
    assert_eq!(opened["content"], "{\"a\":1}\n");
    assert_eq!(opened["hasBom"], true);
    assert_eq!(opened["eol"], "lf");
    assert_eq!(opened["lineCount"], 2);

    let saved = fixture.ok(
        "save_text_file",
        json!({
            "workspaceId": workspace_id,
            "path": &path,
            "request": {
                "content": "{\"a\":2}\n",
                "bom": true,
                "expectedMtimeMs": opened["mtimeMs"],
                "expectedSize": opened["size"],
            },
        }),
    );
    assert_eq!(saved["status"], "saved");
    assert_eq!(saved["size"], 11);

    let conflict = fixture.ok(
        "save_text_file",
        json!({
            "workspaceId": workspace_id,
            "path": &path,
            "request": { "content": "x", "expectedSize": 1 },
        }),
    );
    assert_eq!(conflict["status"], "conflict");
    assert_eq!(conflict["reason"], "modified");

    let escape = format!("{folder_id}/../outside.json");
    fixture.error(
        "open_text_file",
        json!({ "workspaceId": workspace_id, "path": &escape }),
    );
    fixture.error(
        "save_text_file",
        json!({
            "workspaceId": workspace_id,
            "path": &escape,
            "request": { "content": "x", "force": true },
        }),
    );
    assert_eq!(
        fs::read(root.path().join("outside.json")).expect("read outside"),
        b"{}"
    );
}

#[test]
fn ipc_workspace_file_edits_decode_camel_case_and_return_logical_paths() {
    let fixture = IpcApp::new();
    let root = tempfile::tempdir().expect("temp root");
    let project = root.path().join("project");
    fs::create_dir_all(&project).expect("create project");
    fs::write(project.join("draft.txt"), b"draft").expect("write draft");

    let workspace = fixture.ok(
        "add_workspace",
        json!({ "path": project.to_string_lossy() }),
    );
    let workspace_id = workspace["id"].as_str().expect("workspace id");
    let folder_id = workspace["folders"][0]["id"].as_str().expect("folder id");

    let created = fixture.ok(
        "create_workspace_directory",
        json!({ "workspaceId": workspace_id, "path": format!("{folder_id}/notes") }),
    );
    assert_eq!(created, format!("{folder_id}/notes"));

    let moved = fixture.ok(
        "move_workspace_file",
        json!({
            "workspaceId": workspace_id,
            "from": format!("{folder_id}/draft.txt"),
            "to": format!("{folder_id}/notes/final.txt"),
        }),
    );
    assert_eq!(moved, format!("{folder_id}/notes/final.txt"));
    assert_eq!(
        fs::read(project.join("notes/final.txt")).expect("moved file"),
        b"draft"
    );

    fixture.error(
        "delete_workspace_file",
        json!({ "workspaceId": workspace_id, "path": format!("{folder_id}/notes") }),
    );
    let deleted = fixture.ok(
        "delete_workspace_file",
        json!({ "workspaceId": workspace_id, "path": format!("{folder_id}/notes/final.txt") }),
    );
    assert!(deleted.is_null());
    assert!(!project.join("notes/final.txt").exists());
}
