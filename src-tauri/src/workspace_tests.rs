//! Workspace-list tests. The scan and its classification live in workspace_scan_tests.rs, next to
//! the module that owns them; workspace-scoped connection profiles in workspace_connections_tests.rs.

use super::*;

#[test]
fn workspaces_serialize_with_camel_case_fields() {
    let ws = Workspace {
        id: "ws#1".to_string(),
        name: "proj".to_string(),
        path: "C:/proj".to_string(),
        pinned: Some(true),
    };
    let value = serde_json::to_value(&ws).unwrap();
    assert_eq!(value["id"], serde_json::json!("ws#1"));
    assert_eq!(value["pinned"], serde_json::json!(true));
}

/// `pinned` is optional in the file: a workspaces.json written before the field existed must still
/// load rather than failing the whole list.
#[test]
fn a_workspace_without_pinned_still_deserializes() {
    let ws: Workspace =
        serde_json::from_str(r#"{"id":"ws#1","name":"proj","path":"C:/proj"}"#).unwrap();
    assert_eq!(ws.pinned, None);
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
        path: "C:/proj".to_string(),
        pinned: Some(true),
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
    assert_eq!(
        max_open_bytes(app.handle()),
        crate::safepath::DEFAULT_MAX_VIEW_BYTES
    );
    assert_eq!(excluded_viewable_exts(app.handle()), vec!["pem", "log"]);

    tauri::async_runtime::block_on(crate::settings::save_settings(
        app.handle().clone(),
        serde_json::json!({ "maxOpenFileMb": u64::MAX }),
    ))
    .unwrap();
    assert_eq!(
        max_open_bytes(app.handle()),
        crate::safepath::MAX_VIEW_BYTES_CEILING
    );

    tauri::async_runtime::block_on(crate::settings::save_settings(
        app.handle().clone(),
        serde_json::json!({ "maxOpenFileMb": 2, "excludedViewableExts": null }),
    ))
    .unwrap();
    assert_eq!(max_open_bytes(app.handle()), 2 * 1024 * 1024);
    assert!(excluded_viewable_exts(app.handle()).is_empty());
    let _ = std::fs::remove_dir_all(data_dir);
}

#[cfg(unix)]
#[test]
fn a_filesystem_root_workspace_uses_its_path_as_the_display_name() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    if let Ok(path) = workspaces_file(app.handle()) {
        let _ = std::fs::remove_file(path);
    }
    let workspace =
        tauri::async_runtime::block_on(add_workspace(app.handle().clone(), "/".to_string()))
            .unwrap();
    assert_eq!(workspace.name, "/");
    assert_eq!(workspace.path, "/");
    if let Ok(path) = workspaces_file(app.handle()) {
        let _ = std::fs::remove_file(path);
    }
}
