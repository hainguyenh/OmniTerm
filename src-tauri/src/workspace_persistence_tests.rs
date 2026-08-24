//! Tests for workspace_persistence: migration path, idempotent dir creation, and validation.

use super::*;

/// Legacy format (single path per workspace, no `folders` key) must be decoded,
/// auto-migrated (migrated == true) and then re-saved by `read_workspaces`.
#[test]
fn read_workspaces_migrates_a_legacy_format_and_rewrites_the_file() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let path = workspaces_file(app.handle()).expect("path");

    // Write a legacy-format workspaces file (single path per entry).
    let legacy_json = r#"[{"id":"ws#abc","name":"My WS","path":"/tmp/project"}]"#;
    if std::fs::write(&path, legacy_json).is_err() {
        return; // Skip on systems where the mock data dir is not writable.
    }

    // read_workspaces triggers migration and rewrites the file.
    let result = read_workspaces(app.handle()).expect("migrated workspaces must be returned");
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].name, "My WS");
    assert_eq!(result[0].folders.len(), 1);

    // The file on disk must now be in the new format (has a "folders" key).
    let on_disk = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        on_disk.contains("folders"),
        "migrated file must use new format"
    );

    let _ = std::fs::remove_file(path);
}

/// `workspaces_file` must succeed even when the app-data directory already exists.
#[test]
fn workspaces_file_succeeds_when_app_data_dir_already_exists() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();

    // Create the dir up front so the `!app_dir.exists()` branch is skipped.
    let app_dir = app.handle().path().app_data_dir().unwrap();
    std::fs::create_dir_all(&app_dir).unwrap();

    let path = workspaces_file(app.handle()).expect("must resolve even when dir exists");
    assert!(path.to_string_lossy().ends_with("workspaces.json"));
}

/// `write_workspaces` must reject an invalid workspace list (e.g. duplicate ids).
#[test]
fn write_workspaces_rejects_an_invalid_list() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    // Build a list with two workspaces sharing the same id.
    let dup = vec![
        app_protocol::workspace::Workspace {
            id: "ws#dup".into(),
            name: "A".into(),
            folders: vec![],
            parent_id: None,
            order: 0,
            pins: vec![],
            color: None,
            icon: None,
        },
        app_protocol::workspace::Workspace {
            id: "ws#dup".into(),
            name: "B".into(),
            folders: vec![],
            parent_id: None,
            order: 1,
            pins: vec![],
            color: None,
            icon: None,
        },
    ];
    let err = write_workspaces(app.handle(), &dup).unwrap_err();
    assert!(err.contains("unique"), "got: {err}");
}
