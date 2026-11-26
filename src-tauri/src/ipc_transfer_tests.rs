//! End-to-end IPC contract tests for settings export/import, the workspace tree's structural file
//! edits, the built-in plugin list and the terminal Stop command.

use super::IpcApp;
use serde_json::{json, Value};
use std::fs;

#[test]
fn ipc_settings_round_trip_through_an_exported_envelope() {
    let fixture = IpcApp::new();
    let theme = json!({ "id": "ipc-theme", "name": "IPC theme", "colors": {} });
    fixture.ok("save_theme", json!({ "theme": theme }));

    let envelope = fixture.ok("export_settings", json!({}));
    assert_eq!(envelope["version"], 1);
    let sections = envelope["sections"].as_object().expect("sections object");
    let mut keys: Vec<&str> = sections.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, ["appSettings", "connections", "themes", "workspaces"]);
    assert!(envelope["sections"]["themes"]
        .as_array()
        .expect("themes")
        .iter()
        .any(|item| item["id"] == "ipc-theme"));

    let report = fixture.ok(
        "import_settings",
        json!({ "envelope": envelope, "strategy": "replace" }),
    );
    assert_eq!(report["imported"]["appSettings"], 1);
    assert_eq!(report["imported"]["themes"], 1);
    assert_eq!(report["imported"]["workspaces"], 0);

    // Merging keeps the themes already there and adds the incoming ones.
    let merged = fixture.ok(
        "import_settings",
        json!({
            "envelope": { "version": 1, "sections": { "themes": [{ "id": "merged-theme" }] } },
            "strategy": "merge",
        }),
    );
    assert_eq!(merged["imported"], json!({ "themes": 1 }));
    let themes = fixture.ok("list_themes", json!({}));
    for id in ["ipc-theme", "merged-theme"] {
        assert!(
            themes
                .as_array()
                .expect("themes")
                .iter()
                .any(|item| item["id"] == id),
            "{id} missing after merge"
        );
    }

    let failures: [(Value, &str, &str); 3] = [
        (
            json!({ "version": 2 }),
            "merge",
            "Unsupported settings envelope version",
        ),
        (
            json!({ "version": 1, "sections": {} }),
            "upsert",
            "Unknown import strategy",
        ),
        (
            json!({ "version": 1, "sections": { "passwords": [] } }),
            "merge",
            "Unknown section 'passwords'",
        ),
    ];
    for (envelope, strategy, expected) in failures {
        let error = fixture.error(
            "import_settings",
            json!({ "envelope": envelope, "strategy": strategy }),
        );
        assert!(
            error.as_str().is_some_and(|text| text.contains(expected)),
            "{error}"
        );
    }
}

#[test]
fn ipc_workspace_file_commands_create_move_and_delete_inside_the_workspace() {
    let fixture = IpcApp::new();
    let root = tempfile::tempdir().expect("workspace root");
    fs::write(root.path().join("notes.txt"), "notes").expect("seed file");
    let workspace = fixture.ok(
        "add_workspace",
        json!({ "path": root.path().to_string_lossy() }),
    );
    let workspace_id = workspace["id"].as_str().expect("workspace id");
    let folder = workspace["folders"][0]["id"].as_str().expect("folder id");

    let created = fixture.ok(
        "create_workspace_directory",
        json!({ "workspaceId": workspace_id, "path": format!("{folder}/docs") }),
    );
    assert_eq!(created, format!("{folder}/docs"));
    assert!(root.path().join("docs").is_dir());

    let moved = fixture.ok(
        "move_workspace_file",
        json!({
            "workspaceId": workspace_id,
            "from": format!("{folder}/notes.txt"),
            "to": format!("{folder}/docs/renamed.txt"),
        }),
    );
    assert_eq!(moved, format!("{folder}/docs/renamed.txt"));
    assert_eq!(
        fs::read_to_string(root.path().join("docs/renamed.txt")).expect("moved file"),
        "notes"
    );
    assert!(!root.path().join("notes.txt").exists());

    assert_eq!(
        fixture.ok(
            "delete_workspace_file",
            json!({ "workspaceId": workspace_id, "path": format!("{folder}/docs/renamed.txt") }),
        ),
        Value::Null
    );
    assert!(!root.path().join("docs/renamed.txt").exists());

    for (command, body) in [
        (
            "create_workspace_directory",
            json!({ "workspaceId": "missing", "path": "x/docs" }),
        ),
        (
            "move_workspace_file",
            json!({ "workspaceId": "missing", "from": "x/a", "to": "x/b" }),
        ),
        (
            "delete_workspace_file",
            json!({ "workspaceId": "missing", "path": "x/a" }),
        ),
    ] {
        assert!(fixture.error(command, body).is_string(), "{command}");
    }
}

#[test]
fn ipc_lists_builtin_plugins_and_refuses_to_interrupt_without_a_daemon() {
    let fixture = IpcApp::new();
    let ids = fixture.ok("builtin_plugin_ids", json!({}));
    let ids = ids.as_array().expect("plugin ids");
    assert!(!ids.is_empty());
    assert!(ids
        .iter()
        .all(|id| id.as_str().is_some_and(|id| !id.is_empty())));

    let error = fixture.error("interrupt_session", json!({ "id": "missing" }));
    assert!(
        error
            .as_str()
            .is_some_and(|text| text.contains("not initialized")),
        "{error}"
    );
}
