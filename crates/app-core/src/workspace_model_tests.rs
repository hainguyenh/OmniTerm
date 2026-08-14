use super::*;
use std::fs;
use app_protocol::workspace::{Workspace, WorkspaceFolder, WorkspacePin};
use tempfile::TempDir;

fn folder(id: &str, path: &str) -> WorkspaceFolder {
    WorkspaceFolder { id: id.to_string(), name: id.to_string(), path: path.to_string(), color: None }
}

fn workspace(id: &str, parent_id: Option<&str>, order: usize) -> Workspace {
    Workspace {
        id: id.to_string(),
        name: id.to_string(),
        folders: vec![folder(&format!("folder-{id}"), "/tmp")],
        parent_id: parent_id.map(str::to_string),
        order,
        pins: Vec::new(),
        color: None,
        icon: None,
    }
}

#[test]
fn decode_workspaces_handles_empty_and_corrupt_payloads() {
    let empty = decode_workspaces("   \n\t").expect("empty content");
    assert!(empty.workspaces.is_empty());
    assert!(!empty.migrated);

    let corrupt = decode_workspaces("{ not an array }").expect_err("corrupt json");
    assert!(corrupt.contains("corrupt"));

    let bad_array = decode_workspaces("[1, 2, 3]").expect_err("invalid array elements");
    assert!(bad_array.contains("corrupt"));
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
fn validate_workspace_list_catches_invalid_ids_folders_and_parents() {
    let mut empty_id = workspace("   ", None, 0);
    empty_id.id = "".to_string();
    assert!(validate_workspace_list(&[empty_id]).unwrap_err().contains("unique"));

    let dup = vec![workspace("dup", None, 0), workspace("dup", None, 1)];
    assert!(validate_workspace_list(&dup).unwrap_err().contains("unique"));

    let mut bad_folder_id = workspace("a", None, 0);
    bad_folder_id.folders[0].id = "".to_string();
    assert!(validate_workspace_list(&[bad_folder_id]).unwrap_err().contains("invalid folder"));

    let mut bad_folder_path = workspace("a", None, 0);
    bad_folder_path.folders[0].path = "".to_string();
    assert!(validate_workspace_list(&[bad_folder_path]).unwrap_err().contains("invalid folder"));

    let mut dup_folder = workspace("a", None, 0);
    dup_folder.folders = vec![folder("f1", "/tmp"), folder("f1", "/tmp2")];
    assert!(validate_workspace_list(&[dup_folder]).unwrap_err().contains("duplicate"));

    let mut slash_folder = workspace("a", None, 0);
    slash_folder.folders = vec![folder("f/1", "/tmp")];
    assert!(validate_workspace_list(&[slash_folder]).unwrap_err().contains("invalid folder ids"));

    let mut backslash_folder = workspace("a", None, 0);
    backslash_folder.folders = vec![folder("f\\1", "/tmp")];
    assert!(validate_workspace_list(&[backslash_folder]).unwrap_err().contains("invalid folder ids"));

    let mut unknown_pin = workspace("a", None, 0);
    unknown_pin.pins = vec![WorkspacePin { folder_id: "ghost".into(), path: "x".into() }];
    assert!(validate_workspace_list(&[unknown_pin]).unwrap_err().contains("unknown folder"));

    let mut missing_parent = workspace("a", None, 0);
    missing_parent.parent_id = Some("ghost".into());
    assert!(validate_workspace_list(&[missing_parent]).unwrap_err().contains("invalid parent"));

    let cycle_self = vec![
        workspace("a", Some("b"), 0),
        workspace("b", Some("a"), 0),
    ];
    assert!(validate_workspace_list(&cycle_self).unwrap_err().contains("descendants"));

    let cycle_external = vec![
        workspace("d", Some("a"), 0),
        workspace("a", Some("b"), 0),
        workspace("b", Some("a"), 0),
    ];
    assert!(validate_workspace_list(&cycle_external).unwrap_err().contains("cycle"));
}

#[test]
fn parse_workspace_import_validates_extensions_and_skips_invalid_paths() {
    let temp = TempDir::new().expect("temp dir");
    let txt_file = temp.path().join("invalid.txt");
    assert!(parse_workspace_import(&txt_file, "{}").unwrap_err().contains(".code-workspace"));

    let bad_json_file = temp.path().join("bad.workspace");
    assert!(parse_workspace_import(&bad_json_file, "{not json").unwrap_err().contains("invalid JSON"));

    let not_a_dir = temp.path().join("file.txt");
    fs::write(&not_a_dir, b"plain file").expect("write file");
    let real_dir = temp.path().join("real_dir");
    fs::create_dir_all(&real_dir).expect("create dir");

    let valid_file = temp.path().join("my_app.workspace");
    let json = serde_json::json!({
        "folders": [
            { "path": "" },
            { "path": "missing_sub_folder" },
            { "path": "file.txt" },
            { "path": "real_dir", "name": "" },
            { "path": "real_dir" }
        ]
    });
    let imported = parse_workspace_import(&valid_file, &json.to_string()).expect("valid import");
    assert_eq!(imported.name, "my_app");
    assert_eq!(imported.folders.len(), 1);
    assert_eq!(imported.folders[0].name, "real_dir");

    let empty_workspace = temp.path().join("empty.code-workspace");
    let error = parse_workspace_import(&empty_workspace, r#"{"folders":[]}"#).unwrap_err();
    assert!(error.contains("no usable local folder"));
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
    assert_eq!(imported.folders[0].path, dunce::canonicalize(project).unwrap().to_string_lossy());
}

#[test]
fn move_workspace_validates_targets_and_reparents_siblings() {
    let mut list = vec![
        workspace("a", None, 0),
        workspace("b", Some("a"), 0),
        workspace("c", None, 1),
    ];
    assert!(move_workspace(&mut list, "ghost", None, 0).unwrap_err().contains("Unknown workspace"));
    assert!(move_workspace(&mut list, "c", Some("ghost"), 0).unwrap_err().contains("Unknown parent"));
    assert!(move_workspace(&mut list, "a", Some("a"), 0).unwrap_err().contains("cannot contain itself"));
    assert!(move_workspace(&mut list, "a", Some("b"), 0).unwrap_err().contains("descendants"));

    move_workspace(&mut list, "c", Some("a"), 0).expect("move c under a");
    assert_eq!(list.iter().find(|w| w.id == "c").unwrap().parent_id.as_deref(), Some("a"));
    assert_eq!(list.iter().find(|w| w.id == "c").unwrap().order, 0);
    assert_eq!(list.iter().find(|w| w.id == "b").unwrap().order, 1);

    move_workspace(&mut list, "b", None, 0).expect("move b back to root");
    assert_eq!(list.iter().find(|w| w.id == "b").unwrap().parent_id, None);
    assert_eq!(list.iter().find(|w| w.id == "b").unwrap().order, 0);
    assert_eq!(list.iter().find(|w| w.id == "a").unwrap().order, 1);
}

#[test]
fn normalize_workspace_orders_densifies_all_parent_groups() {
    let mut list = vec![
        workspace("root-2", None, 8),
        workspace("root-1", None, 3),
        workspace("child-2", Some("root-1"), 5),
        workspace("child-1", Some("root-1"), 1),
    ];
    normalize_workspace_orders(&mut list);
    assert_eq!(list.iter().find(|w| w.id == "root-1").unwrap().order, 0);
    assert_eq!(list.iter().find(|w| w.id == "root-2").unwrap().order, 1);
    assert_eq!(list.iter().find(|w| w.id == "child-1").unwrap().order, 0);
    assert_eq!(list.iter().find(|w| w.id == "child-2").unwrap().order, 1);
}

#[test]
fn pin_management_and_logical_targets_resolve_and_format_paths() {
    let mut ws = workspace("a", None, 0);
    ws.folders = vec![folder("root", "/repo")];

    assert!(set_entry_pinned(&mut ws, "missing", "src/lib.rs", true).is_err());
    set_entry_pinned(&mut ws, "root", "/src/lib.rs/", true).expect("pin");
    assert_eq!(ws.pins, vec![WorkspacePin { folder_id: "root".into(), path: "src/lib.rs".into() }]);
    assert!(is_entry_pinned(&ws, "root", "src/lib.rs"));
    assert!(!is_entry_pinned(&ws, "root", "other.rs"));
    assert!(!is_entry_pinned(&ws, "other", "src/lib.rs"));

    set_entry_pinned(&mut ws, "root", "src/lib.rs", false).expect("unpin");
    assert!(ws.pins.is_empty());
    assert!(!is_entry_pinned(&ws, "root", "src/lib.rs"));

    assert!(logical_target(&ws, "").is_err());
    assert!(logical_target(&ws, "missing/path").is_err());
    let root_only = logical_target(&ws, "/root/").expect("root folder target");
    assert_eq!(root_only.folder.id, "root");
    assert_eq!(root_only.relative_path, "");

    let nested = logical_target(&ws, "root/src/app.rs").expect("nested target");
    assert_eq!(nested.folder.id, "root");
    assert_eq!(nested.relative_path, "src/app.rs");

    assert_eq!(namespace_path("root", ""), "root");
    assert_eq!(namespace_path("root", "/"), "root");
    assert_eq!(namespace_path("root", "/src/main.rs/"), "root/src/main.rs");
}

/// Validates the `parent_id == workspace.id` self-reference branch in `validate_workspace_list`.
/// A workspace whose `parent_id` equals its own `id` is caught as an invalid parent.
#[test]
fn validate_rejects_workspace_that_is_its_own_parent() {
    let mut self_parent = workspace("loop", None, 0);
    self_parent.parent_id = Some("loop".to_string());
    let err = validate_workspace_list(&[self_parent]).unwrap_err();
    assert!(err.contains("invalid parent"), "got: {err}");
}

/// Validates that `ensure_no_cycle` catches a direct cycle via the visited-set path.
/// The existing test exercises the `parent == workspace_id` guard; this one exercises
/// the `!visited.insert(parent)` guard when a cycle is formed through a third node.
#[test]
fn validate_rejects_a_three_node_cycle() {
    // a → b → c → b (c's parent is b which we visit twice)
    let workspaces = vec![
        workspace("a", Some("b"), 0),
        workspace("b", Some("c"), 1),
        workspace("c", Some("b"), 2),
    ];
    let err = validate_workspace_list(&workspaces).unwrap_err();
    // The error may say "descendants" (a → b → c → b hits the workspace_id guard on b)
    // or "cycle" (the visited set fires); either is correct.
    assert!(
        err.contains("descendants") || err.contains("cycle") || err.contains("invalid parent"),
        "got: {err}"
    );
}

/// `namespace_path` with an empty relative path should return only the folder id.
#[test]
fn namespace_path_with_slash_only_relative_returns_folder_id() {
    assert_eq!(namespace_path("root", "/"), "root");
    assert_eq!(namespace_path("f", "///"), "f");
}
