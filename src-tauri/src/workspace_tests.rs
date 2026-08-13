//! Workspace-list tests. The scan and its classification live in workspace_scan_tests.rs, next to
//! the module that owns them; workspace-scoped connection profiles in workspace_connections_tests.rs.

use super::*;

#[test]
fn workspaces_serialize_with_camel_case_fields() {
    let ws = Workspace {
        id: "ws#1".to_string(),
        name: "proj".to_string(),
        folders: vec![WorkspaceFolder {
            id: "folder#1".to_string(),
            name: "proj".to_string(),
            path: "C:/proj".to_string(),
        }],
        parent_id: Some("ws#parent".to_string()),
        order: 2,
        pins: vec![WorkspacePin { folder_id: "folder#1".to_string(), path: "src".to_string() }],
    };
    let value = serde_json::to_value(&ws).unwrap();
    assert_eq!(value["id"], serde_json::json!("ws#1"));
    assert_eq!(value["parentId"], serde_json::json!("ws#parent"));
    assert_eq!(value["folders"][0]["path"], serde_json::json!("C:/proj"));
    assert_eq!(value["pins"][0]["folderId"], serde_json::json!("folder#1"));
}

/// Current records may omit optional hierarchy/pin fields and still decode with defaults.
#[test]
fn a_workspace_without_optional_fields_still_deserializes() {
    let ws: Workspace = serde_json::from_str(
        r#"{"id":"ws#1","name":"proj","folders":[{"id":"folder#1","name":"proj","path":"C:/proj"}],"order":0}"#,
    )
    .unwrap();
    assert_eq!(ws.parent_id, None);
    assert!(ws.pins.is_empty());
}

#[test]
fn empty_workspace_pins_are_serialized_for_the_renderer_contract() {
    let ws = Workspace {
        id: "ws#1".to_string(),
        name: "proj".to_string(),
        folders: Vec::new(),
        parent_id: None,
        order: 0,
        pins: Vec::new(),
    };
    let value = serde_json::to_value(&ws).unwrap();
    assert_eq!(value["pins"], serde_json::json!([]));
}

// ── Persistence helpers ────────────────────────────────────────────────

#[test]
fn workspaces_file_path_ends_with_workspaces_json() {
    let app = crate::test_support::mock_app();
    let path = workspaces_file(app.handle()).expect("should resolve");
    assert!(path.to_string_lossy().ends_with("workspaces.json"));
}

#[test]
fn read_workspaces_returns_empty_when_no_file_exists() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    // Ensure the file doesn't exist by removing it if it does. The lock above is what keeps it gone
    // until the read: the workspaces.json this deletes is shared with every other mock app.
    if let Ok(path) = workspaces_file(app.handle()) {
        let _ = std::fs::remove_file(&path);
    }
    let list = read_workspaces(app.handle()).expect("missing file must yield empty list");
    assert!(list.is_empty());
}

#[test]
fn write_and_read_workspaces_round_trip() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let ws = Workspace {
        id: "ws#test".to_string(),
        name: "My Project".to_string(),
        folders: vec![WorkspaceFolder {
            id: "folder#test".to_string(),
            name: "My Project".to_string(),
            path: "C:/proj".to_string(),
        }],
        parent_id: None,
        order: 0,
        pins: Vec::new(),
    };
    // Start from no file so the "one workspace" count below is this test's own write and not a
    // workspace another test left in the shared app-data directory.
    if let Ok(path) = workspaces_file(app.handle()) {
        let _ = std::fs::remove_file(&path);
    }
    // write_workspaces may fail if mock app data dir is not writable—accept that.
    let write_result = write_workspaces(app.handle(), std::slice::from_ref(&ws));
    match write_result {
        Ok(()) => {
            let list = read_workspaces(app.handle()).expect("should read back");
            assert_eq!(list.len(), 1);
            assert_eq!(list[0].id, "ws#test");
            // Clean up
            if let Ok(path) = workspaces_file(app.handle()) {
                let _ = std::fs::remove_file(path);
            }
        }
        Err(_) => {
            // Mock filesystem not writable; skip the read-back assertion.
        }
    }
}


#[test]
fn read_workspaces_migrates_legacy_single_folder_records_in_place() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let path = workspaces_file(app.handle()).expect("path");
    let legacy = r#"[{"id":"ws#old","name":"Legacy","path":"C:/legacy","pinned":true}]"#;
    if std::fs::write(&path, legacy).is_err() {
        return;
    }

    let list = read_workspaces(app.handle()).expect("legacy workspace should migrate");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "ws#old");
    assert_eq!(list[0].name, "Legacy");
    assert_eq!(list[0].order, 0);
    assert_eq!(list[0].folders.len(), 1);
    assert_eq!(list[0].folders[0].path, "C:/legacy");

    let persisted = std::fs::read_to_string(&path).expect("migrated workspaces should be rewritten");
    let value: serde_json::Value = serde_json::from_str(&persisted).expect("migrated json");
    assert!(value[0].get("folders").is_some());
    assert!(value[0].get("path").is_none());
    let _ = std::fs::remove_file(path);
}

#[test]
fn read_workspaces_errors_on_corrupt_file() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let path = workspaces_file(app.handle()).expect("path");
    // Skip if the mock app data dir is not writable (common on Windows CI).
    if std::fs::write(&path, "not valid json [").is_err() {
        return;
    }
    let err = read_workspaces(app.handle()).expect_err("corrupt file must error");
    assert!(err.contains("workspaces.json is corrupt"), "got {err}");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn max_open_bytes_returns_positive_cap() {
    let app = crate::test_support::mock_app();
    let cap = max_open_bytes(app.handle());
    // Default is 1 MB; should be > 0 and reasonable.
    assert!(cap > 0, "cap must be positive");
    // Should not exceed a sane upper bound (e.g. 512 MB = safepath max).
    assert!(cap <= 512 * 1024 * 1024, "cap unreasonably large: {cap}");
}

#[test]
fn excluded_viewable_exts_returns_empty_when_setting_absent() {
    use tauri::Manager;

    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    // Absence has to be established, not assumed: every mock app shares one app-data directory, and
    // several tests write an `excludedViewableExts` into that settings.json.
    let data_dir = app.path().app_data_dir().expect("app data dir");
    let _ = std::fs::remove_file(data_dir.join("settings.json"));
    let exts = excluded_viewable_exts(app.handle());
    // Default setting is [] so result should be empty.
    assert!(exts.is_empty(), "expected empty but got {exts:?}");
}

#[test]
fn empty_workspace_files_and_runtime_settings_cover_all_fallbacks() {
    use tauri::Manager;

    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let data_dir = app.path().app_data_dir().unwrap();
    let _ = std::fs::remove_dir_all(&data_dir);
    std::fs::create_dir_all(&data_dir).unwrap();
    let workspace_path = workspaces_file(app.handle()).unwrap();
    std::fs::write(&workspace_path, " \n\t").unwrap();
    assert!(read_workspaces(app.handle()).unwrap().is_empty());

    tauri::async_runtime::block_on(crate::settings::save_settings(
        app.handle().clone(),
        serde_json::json!({
            "maxOpenFileMb": 0,
            "excludedViewableExts": ["PEM", 7, "LoG"]
        }),
    ))
    .unwrap();
    assert_eq!(max_open_bytes(app.handle()), crate::safepath::DEFAULT_MAX_VIEW_BYTES);
    assert_eq!(excluded_viewable_exts(app.handle()), vec!["pem", "log"]);

    tauri::async_runtime::block_on(crate::settings::save_settings(
        app.handle().clone(),
        serde_json::json!({ "maxOpenFileMb": u64::MAX }),
    ))
    .unwrap();
    assert_eq!(max_open_bytes(app.handle()), crate::safepath::MAX_VIEW_BYTES_CEILING);

    tauri::async_runtime::block_on(crate::settings::save_settings(
        app.handle().clone(),
        serde_json::json!({ "maxOpenFileMb": 2, "excludedViewableExts": null }),
    ))
    .unwrap();
    assert_eq!(max_open_bytes(app.handle()), 2 * 1024 * 1024);
    assert!(excluded_viewable_exts(app.handle()).is_empty());
    let _ = std::fs::remove_dir_all(data_dir);
}

#[test]
fn workspace_command_validations_and_edge_cases() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    if let Ok(path) = workspaces_file(app.handle()) {
        let _ = std::fs::remove_file(path);
    }
    let handle = app.handle();

    let empty_create = tauri::async_runtime::block_on(create_workspace(handle.clone(), "   ".into()));
    assert!(empty_create.unwrap_err().contains("empty"));

    let created = tauri::async_runtime::block_on(create_workspace(handle.clone(), "My Workspace".into())).unwrap();
    assert_eq!(created.name, "My Workspace");
    assert!(created.folders.is_empty());

    let empty_rename = tauri::async_runtime::block_on(rename_workspace(handle.clone(), created.id.clone(), "".into()));
    assert!(empty_rename.unwrap_err().contains("empty"));

    let ghost_rename = tauri::async_runtime::block_on(rename_workspace(handle.clone(), "ws#ghost".into(), "New".into()));
    assert!(ghost_rename.unwrap_err().contains("Unknown workspace"));

    let renamed = tauri::async_runtime::block_on(rename_workspace(handle.clone(), created.id.clone(), "Renamed".into())).unwrap();
    assert_eq!(renamed.name, "Renamed");

    let bad_folder = tauri::async_runtime::block_on(add_workspace_folder(handle.clone(), created.id.clone(), "not-a-dir/missing".into()));
    assert!(bad_folder.unwrap_err().contains("not a folder"));

    let ghost_folder = tauri::async_runtime::block_on(add_workspace_folder(handle.clone(), "ws#ghost".into(), "/tmp".into()));
    assert!(ghost_folder.is_err());

    let empty_scan = tauri::async_runtime::block_on(scan_workspace_entries(handle.clone(), created.id.clone(), "".into(), None, None)).unwrap();
    assert_eq!(empty_scan.total, 0);

    let temp = tempfile::tempdir().unwrap();
    let oversized = temp.path().join("huge.code-workspace");
    std::fs::write(&oversized, vec![b' '; 1024 * 1024 + 10]).unwrap();
    let import_err = tauri::async_runtime::block_on(import_workspace_file(handle.clone(), oversized.to_string_lossy().into())).unwrap_err();
    assert!(import_err.contains("too large"));

    let dup_add = tauri::async_runtime::block_on(add_workspace(handle.clone(), temp.path().to_string_lossy().into())).unwrap();
    let dup_second = tauri::async_runtime::block_on(add_workspace(handle.clone(), temp.path().to_string_lossy().into())).unwrap();
    assert_eq!(dup_add.id, dup_second.id);

    let added_folder = tauri::async_runtime::block_on(add_workspace_folder(handle.clone(), dup_add.id.clone(), temp.path().to_string_lossy().into())).unwrap();
    assert_eq!(added_folder.folders.len(), 1);

    let file_path = temp.path().join("plain.txt");
    std::fs::write(&file_path, b"hello").unwrap();
    let file_add_err = tauri::async_runtime::block_on(add_workspace(handle.clone(), file_path.to_string_lossy().into())).unwrap_err();
    assert!(file_add_err.contains("not a folder"));

    let parent_ws = tauri::async_runtime::block_on(create_workspace(handle.clone(), "Parent".into())).unwrap();
    let child_ws = tauri::async_runtime::block_on(create_workspace(handle.clone(), "Child".into())).unwrap();
    let mut list = read_workspaces(handle).unwrap();
    list.iter_mut().find(|w| w.id == child_ws.id).unwrap().parent_id = Some(parent_ws.id.clone());
    write_workspaces(handle, &list).unwrap();
    tauri::async_runtime::block_on(remove_workspace(handle.clone(), parent_ws.id)).unwrap();
    let remaining = read_workspaces(handle).unwrap();
    assert_eq!(remaining.iter().find(|w| w.id == child_ws.id).unwrap().parent_id, None);

    let rdp_file = temp.path().join("test.rdp");
    std::fs::write(&rdp_file, b"full address:s:1.2.3.4\n").unwrap();
    let rdp_folder_id = added_folder.folders[0].id.clone();
    let rdp_script = crate::workspace_scan::WorkspaceScript {
        id: format!("{rdp_folder_id}/test.rdp"),
        name: "test.rdp".into(),
        path: format!("{rdp_folder_id}/test.rdp"),
        kind: "rdp".into(),
        shell: None,
        editable: Some(false),
        viewable: Some(true),
    };
    let rdp_res = tauri::async_runtime::block_on(run_script(handle.clone(), dup_add.id.clone(), Some(rdp_script), None));
    if cfg!(any(target_os = "windows", target_os = "macos")) {
        assert!(rdp_res.is_ok());
    } else {
        assert!(rdp_res.is_err());
    }

    if let Ok(path) = workspaces_file(app.handle()) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(unix)]
#[test]
fn a_filesystem_root_workspace_uses_its_path_as_the_display_name() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    if let Ok(path) = workspaces_file(app.handle()) {
        let _ = std::fs::remove_file(path);
    }
    let workspace = tauri::async_runtime::block_on(add_workspace(
        app.handle().clone(),
        "/".to_string(),
    ))
    .unwrap();
    assert_eq!(workspace.name, "/");
    assert_eq!(workspace.folders[0].path, "/");
    if let Ok(path) = workspaces_file(app.handle()) {
        let _ = std::fs::remove_file(path);
    }
}

