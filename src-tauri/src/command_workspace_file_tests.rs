//! The workspace tree's structural edits, driven through the mock runtime: logical path
//! resolution across two folders, and pins following a renamed, moved or deleted file.

use super::*;
use crate::workspace_file_commands::{
    create_workspace_directory, delete_workspace_file, move_workspace_file,
};
use tempfile::TempDir;

fn stored_pins(app: &tauri::AppHandle<MockRuntime>, id: &str) -> Vec<(String, String)> {
    workspace::read_workspaces(app)
        .expect("read workspaces")
        .into_iter()
        .find(|item| item.id == id)
        .expect("stored workspace")
        .pins
        .into_iter()
        .map(|pin| (pin.folder_id, pin.path))
        .collect()
}

#[test]
fn workspace_file_commands_create_rename_move_and_delete_with_pins() {
    let fixture = MockApp::new();
    let app = fixture.handle();
    let root = TempDir::new().expect("temp root");
    let first = root.path().join("first");
    let second = root.path().join("second");
    write_file(first.join("notes.txt"), b"notes");
    fs::create_dir_all(&second).expect("create second folder");

    let added = block_on(workspace::add_workspace(
        app.clone(),
        first.to_string_lossy().into_owned(),
    ))
    .expect("add workspace");
    let workspace = block_on(workspace_folders::add_workspace_folder(
        app.clone(),
        added.id.clone(),
        second.to_string_lossy().into_owned(),
    ))
    .expect("add second folder");
    let (a, b) = (
        workspace.folders[0].id.clone(),
        workspace.folders[1].id.clone(),
    );
    block_on(workspace::set_workspace_entry_pinned(
        app.clone(),
        workspace.id.clone(),
        a.clone(),
        "notes.txt".to_string(),
        true,
    ))
    .expect("pin notes");

    let created = block_on(create_workspace_directory(
        app.clone(),
        workspace.id.clone(),
        format!("{a}/docs"),
    ))
    .expect("create docs");
    assert_eq!(created, format!("{a}/docs"));
    assert!(first.join("docs").is_dir());

    let renamed = block_on(move_workspace_file(
        app.clone(),
        workspace.id.clone(),
        format!("{a}/notes.txt"),
        format!("{a}/docs/readme.md"),
    ))
    .expect("rename into docs");
    assert_eq!(renamed, format!("{a}/docs/readme.md"));
    assert_eq!(
        stored_pins(&app, &workspace.id),
        vec![(a.clone(), "docs/readme.md".to_string())]
    );

    let moved = block_on(move_workspace_file(
        app.clone(),
        workspace.id.clone(),
        renamed,
        format!("{b}/readme.md"),
    ))
    .expect("move to the second folder");
    assert_eq!(moved, format!("{b}/readme.md"));
    assert_eq!(
        fs::read(second.join("readme.md")).expect("moved file"),
        b"notes"
    );
    assert_eq!(
        stored_pins(&app, &workspace.id),
        vec![(b.clone(), "readme.md".to_string())]
    );

    block_on(delete_workspace_file(
        app.clone(),
        workspace.id.clone(),
        moved,
    ))
    .expect("delete readme");
    assert!(!second.join("readme.md").exists());
    assert!(stored_pins(&app, &workspace.id).is_empty());
}

#[test]
fn workspace_file_commands_reject_unknown_targets_and_folder_roots() {
    let fixture = MockApp::new();
    let app = fixture.handle();
    let root = TempDir::new().expect("temp root");
    write_file(root.path().join("project/keep.txt"), b"keep");
    let workspace = block_on(workspace::add_workspace(
        app.clone(),
        root.path().join("project").to_string_lossy().into_owned(),
    ))
    .expect("add workspace");
    let folder = workspace.folders[0].id.clone();

    assert!(block_on(create_workspace_directory(
        app.clone(),
        "ws#missing".to_string(),
        format!("{folder}/x"),
    ))
    .is_err());
    assert!(block_on(move_workspace_file(
        app.clone(),
        workspace.id.clone(),
        format!("{folder}/keep.txt"),
        "folder#missing/keep.txt".to_string(),
    ))
    .is_err());
    assert!(
        block_on(delete_workspace_file(
            app.clone(),
            workspace.id.clone(),
            folder.clone()
        ))
        .is_err(),
        "a workspace folder root is not a file"
    );
    assert!(block_on(delete_workspace_file(
        app,
        workspace.id,
        format!("{folder}/../outside.txt"),
    ))
    .is_err());
    assert!(root.path().join("project/keep.txt").exists());
}
