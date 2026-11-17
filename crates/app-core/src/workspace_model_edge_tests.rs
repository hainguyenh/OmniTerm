//! Edge cases for `workspace_model`: rejected lists, legacy roots, absolute imports, pins that
//! belong to other folders and sibling normalization.

use super::*;
use app_protocol::workspace::{Workspace, WorkspaceFolder, WorkspacePin};
use std::fs;
use tempfile::TempDir;

fn workspace(id: &str, parent_id: Option<&str>, order: usize) -> Workspace {
    Workspace {
        id: id.to_string(),
        name: id.to_string(),
        folders: vec![
            WorkspaceFolder {
                id: format!("folder-{id}"),
                name: id.to_string(),
                path: "/tmp".to_string(),
                color: None,
            },
            WorkspaceFolder {
                id: "other".to_string(),
                name: "other".to_string(),
                path: "/srv".to_string(),
                color: None,
            },
        ],
        parent_id: parent_id.map(str::to_string),
        order,
        pins: Vec::new(),
        color: None,
        icon: None,
    }
}

fn pin(folder_id: &str, path: &str) -> WorkspacePin {
    WorkspacePin {
        folder_id: folder_id.to_string(),
        path: path.to_string(),
    }
}

#[test]
fn decode_rejects_invalid_current_and_legacy_lists() {
    let duplicate = r#"[
      {"id":"ws#one","name":"One","folders":[],"order":0},
      {"id":"ws#one","name":"Again","folders":[],"order":1}
    ]"#;
    assert!(decode_workspaces(duplicate).unwrap_err().contains("unique"));

    let legacy_without_name = r#"[{"id":"ws#one","path":"/one"}]"#;
    assert!(decode_workspaces(legacy_without_name)
        .unwrap_err()
        .contains("corrupt"));

    let legacy_duplicate = r#"[
      {"id":"ws#one","name":"One","path":"/one"},
      {"id":"ws#one","name":"Two","path":"/two"}
    ]"#;
    assert!(decode_workspaces(legacy_duplicate)
        .unwrap_err()
        .contains("unique"));
}

#[test]
fn legacy_root_path_keeps_the_raw_path_as_folder_name() {
    let decoded =
        decode_workspaces(r#"[{"id":"ws#root","name":"Root","path":"/"}]"#).expect("legacy root");
    assert_eq!(decoded.workspaces[0].folders[0].id, "folder#root");
    assert_eq!(decoded.workspaces[0].folders[0].name, "/");
}

#[test]
fn validate_accepts_pins_for_known_folders() {
    let mut item = workspace("ws", None, 0);
    item.pins.push(WorkspacePin {
        folder_id: "folder-ws".to_string(),
        path: "src/main.rs".to_string(),
    });
    assert_eq!(validate_workspace_list(&[item]), Ok(()));
}

#[test]
fn workspace_import_accepts_absolute_folder_paths() {
    let temp = TempDir::new().expect("temp dir");
    let project = temp.path().join("abs");
    fs::create_dir_all(&project).expect("project folder");
    let elsewhere = TempDir::new().expect("second temp dir");
    let file = elsewhere.path().join("abs.code-workspace");
    let json = serde_json::json!({ "folders": [{ "path": project.to_string_lossy() }] });

    let imported = parse_workspace_import(&file, &json.to_string()).expect("absolute import");
    assert_eq!(imported.folders.len(), 1);
    assert_eq!(imported.folders[0].name, "abs");
    assert_eq!(
        imported.folders[0].path,
        dunce::canonicalize(&project)
            .expect("canonical")
            .to_string_lossy()
    );
}

#[test]
fn pinning_leaves_the_same_path_in_another_folder_alone() {
    let mut item = workspace("ws", None, 0);
    item.pins.push(pin("other", "README.md"));
    set_entry_pinned(&mut item, "folder-ws", "/README.md/", true).expect("pin");
    set_entry_pinned(&mut item, "folder-ws", "README.md", false).expect("unpin");
    assert_eq!(item.pins, vec![pin("other", "README.md")]);
}

#[test]
fn moving_a_pin_matches_folder_and_path_together() {
    let mut item = workspace("ws", None, 0);
    item.pins.push(pin("other", "a.txt"));
    item.pins.push(pin("folder-ws", "a.txt"));
    assert!(move_entry_pin(
        &mut item,
        "folder-ws",
        "/a.txt",
        "other",
        "b.txt/"
    ));
    assert_eq!(
        item.pins,
        vec![pin("other", "a.txt"), pin("other", "b.txt")]
    );
}

#[test]
fn normalizing_with_an_unknown_insertion_only_densifies_siblings() {
    let mut items = vec![workspace("a", None, 4), workspace("b", None, 9)];
    normalize_siblings(&mut items, None, Some(("missing", 0)));
    let orders: Vec<_> = items
        .iter()
        .map(|item| (item.id.as_str(), item.order))
        .collect();
    assert_eq!(orders, vec![("a", 0), ("b", 1)]);
}
