use super::*;
use app_protocol::workspace::{Workspace, WorkspaceFolder, WorkspacePin};
use std::fs;
use tempfile::TempDir;

fn folder(id: &str, path: &str) -> WorkspaceFolder {
    WorkspaceFolder { id: id.to_string(), name: id.to_string(), path: path.to_string() }
}

fn workspace(id: &str, parent_id: Option<&str>, order: usize) -> Workspace {
    Workspace {
        id: id.to_string(),
        name: id.to_string(),
        folders: vec![folder(&format!("folder-{id}"), "/tmp")],
        parent_id: parent_id.map(str::to_string),
        order,
        pins: Vec::new(),
    }
}

#[test]
fn legacy_workspace_records_migrate_preserving_identity_and_order() {
    let json = r#"[
      {"id":"ws#one","name":"One","path":"/one","pinned":true},
      {"id":"ws#two","name":"Two","path":"/two"}
    ]"#;
    let decoded = decode_workspaces(json).expect("legacy list should migrate");
    assert!(decoded.migrated);
    assert_eq!(decoded.workspaces[0].id, "ws#one");
    assert_eq!(decoded.workspaces[0].name, "One");
    assert_eq!(decoded.workspaces[0].order, 0);
    assert_eq!(decoded.workspaces[0].folders[0].path, "/one");
    assert_eq!(decoded.workspaces[1].order, 1);
}

#[test]
fn current_workspace_records_do_not_report_a_migration() {
    let json = r#"[{"id":"ws#one","name":"One","folders":[{"id":"root","name":"Root","path":"/one"}],"order":4}]"#;
    let decoded = decode_workspaces(json).expect("current list should load");
    assert!(!decoded.migrated);
    assert_eq!(decoded.workspaces[0].folders[0].id, "root");
}

#[test]
fn vscode_workspace_import_resolves_relative_paths_and_deduplicates_roots() {
    let temp = TempDir::new().expect("temp dir");
    let project = temp.path().join("project");
    fs::create_dir_all(&project).expect("project folder");
    let file = temp.path().join("team.code-workspace");
    let json = r#"{
      "folders": [
        {"name":"Project","path":"project"},
        {"path":"./project"},
        {"uri":"vscode-remote://ssh-remote+host/project"}
      ],
      "settings": {"ignored": true}
    }"#;
    let imported = parse_workspace_import(&file, json).expect("valid import");
    assert_eq!(imported.name, "team");
    assert_eq!(imported.folders.len(), 1);
    assert_eq!(imported.folders[0].name, "Project");
    assert_eq!(imported.folders[0].path, fs::canonicalize(project).unwrap().to_string_lossy());
}

#[test]
fn workspace_import_skips_missing_local_roots_when_another_root_is_usable() {
    let temp = TempDir::new().expect("temp dir");
    let project = temp.path().join("project");
    fs::create_dir_all(&project).expect("project folder");
    let file = temp.path().join("partial.workspace");
    let imported = parse_workspace_import(
        &file,
        r#"{"folders":[{"path":"missing"},{"name":"Project","path":"project"}]}"#,
    )
    .expect("one usable local root should be enough");
    assert_eq!(imported.folders.len(), 1);
    assert_eq!(imported.folders[0].name, "Project");
    assert_eq!(imported.folders[0].path, fs::canonicalize(project).unwrap().to_string_lossy());
}

#[test]
fn workspace_import_rejects_files_without_local_folders() {
    let temp = TempDir::new().expect("temp dir");
    let file = temp.path().join("remote.workspace");
    let error = parse_workspace_import(
        &file,
        r#"{"folders":[{"uri":"vscode-remote://ssh-remote+host/project"}]}"#,
    )
    .expect_err("remote-only import must fail");
    assert!(error.contains("local folder"));
}

#[test]
fn workspace_validation_rejects_folder_ids_with_path_separators() {
    let mut ws = workspace("a", None, 0);
    ws.folders[0].id = r"bad\folder".to_string();
    let error = validate_workspace_list(&[ws]).expect_err("folder ids are logical namespace segments");
    assert!(error.contains("folder ids"));
}

#[test]
fn hierarchy_move_rejects_cycles_and_normalizes_sibling_order() {
    let mut list = vec![workspace("a", None, 0), workspace("b", Some("a"), 0), workspace("c", None, 1)];
    let error = move_workspace(&mut list, "a", Some("b"), 0).expect_err("cycle must fail");
    assert!(error.contains("descendant"));

    move_workspace(&mut list, "c", Some("a"), 0).expect("move should work");
    let c = list.iter().find(|item| item.id == "c").unwrap();
    let b = list.iter().find(|item| item.id == "b").unwrap();
    assert_eq!(c.parent_id.as_deref(), Some("a"));
    assert_eq!(c.order, 0);
    assert_eq!(b.order, 1);
}

#[test]
fn pin_toggle_is_idempotent_and_logical_paths_resolve_a_known_folder() {
    let mut ws = workspace("a", None, 0);
    ws.folders = vec![folder("root", "/repo")];
    set_entry_pinned(&mut ws, "root", "src/lib.rs", true).expect("pin");
    set_entry_pinned(&mut ws, "root", "src/lib.rs", true).expect("pin twice");
    assert_eq!(ws.pins, vec![WorkspacePin { folder_id: "root".into(), path: "src/lib.rs".into() }]);
    assert!(is_entry_pinned(&ws, "root", "src/lib.rs"));

    let target = logical_target(&ws, "root/src/lib.rs").expect("logical target");
    assert_eq!(target.folder.id, "root");
    assert_eq!(target.relative_path, "src/lib.rs");
    assert!(logical_target(&ws, "missing/file").is_err());
}
