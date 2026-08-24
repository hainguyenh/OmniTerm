//! Command-path validation and edge cases for workspace operations. 
use super::*;
use crate::workspace_folders::{add_workspace_folder, remove_workspace_folder};
#[test]
fn workspace_command_validations_and_edge_cases() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    if let Ok(path) = workspaces_file(app.handle()) {
        let _ = std::fs::remove_file(path);
    }

    let handle = app.handle();

    let empty_create =
        tauri::async_runtime::block_on(create_workspace(handle.clone(), "   ".into()));
    assert!(empty_create.unwrap_err().contains("empty"));

    let created =
        tauri::async_runtime::block_on(create_workspace(handle.clone(), "My Workspace".into()))
            .unwrap();
    assert_eq!(created.name, "My Workspace");
    assert!(created.folders.is_empty());

    let empty_rename = tauri::async_runtime::block_on(rename_workspace(
        handle.clone(),
        created.id.clone(),
        "".into(),
    ));
    assert!(empty_rename.unwrap_err().contains("empty"));

    let ghost_rename = tauri::async_runtime::block_on(rename_workspace(
        handle.clone(),
        "ws#ghost".into(),
        "New".into(),
    ));
    assert!(ghost_rename.unwrap_err().contains("Unknown workspace"));

    let renamed = tauri::async_runtime::block_on(rename_workspace(
        handle.clone(),
        created.id.clone(),
        "Renamed".into(),
    ))
    .unwrap();
    assert_eq!(renamed.name, "Renamed");

    let bad_folder = tauri::async_runtime::block_on(add_workspace_folder(
        handle.clone(),
        created.id.clone(),
        "not-a-dir/missing".into(),
    ));
    assert!(bad_folder.unwrap_err().contains("not a folder"));

    let ghost_folder = tauri::async_runtime::block_on(add_workspace_folder(
        handle.clone(),
        "ws#ghost".into(),
        "/tmp".into(),
    ));
    assert!(ghost_folder.is_err());

    let empty_scan = tauri::async_runtime::block_on(scan_workspace_entries(
        handle.clone(),
        created.id.clone(),
        "".into(),
        None,
        None,
    ))
    .unwrap();
    assert_eq!(empty_scan.total, 0);

    let temp = tempfile::tempdir().unwrap();
    let oversized = temp.path().join("huge.code-workspace");
    std::fs::write(&oversized, vec![b' '; 1024 * 1024 + 10]).unwrap();
    let import_err = tauri::async_runtime::block_on(import_workspace_file(
        handle.clone(),
        oversized.to_string_lossy().into(),
    ))
    .unwrap_err();
    assert!(import_err.contains("too large"));

    let dup_add = tauri::async_runtime::block_on(add_workspace(
        handle.clone(),
        temp.path().to_string_lossy().into(),
    ))
    .unwrap();
    let dup_second = tauri::async_runtime::block_on(add_workspace(
        handle.clone(),
        temp.path().to_string_lossy().into(),
    ))
    .unwrap();
    assert_eq!(dup_add.id, dup_second.id);

    let added_folder = tauri::async_runtime::block_on(add_workspace_folder(
        handle.clone(),
        dup_add.id.clone(),
        temp.path().to_string_lossy().into(),
    ))
    .unwrap();
    assert_eq!(added_folder.folders.len(), 1);

    let unlink_path = temp.path().join("unlink-me");
    std::fs::create_dir(&unlink_path).unwrap();
    let unlink_folder = tauri::async_runtime::block_on(add_workspace_folder(
        handle.clone(),
        dup_add.id.clone(),
        unlink_path.to_string_lossy().into(),
    ))
    .unwrap();
    let folder_id = unlink_folder
        .folders
        .last()
        .expect("unlink folder should be added")
        .id
        .clone();
    let pinned = tauri::async_runtime::block_on(set_workspace_entry_pinned(
        handle.clone(),
        dup_add.id.clone(),
        folder_id.clone(),
        "scripts".into(),
        true,
    ))
    .unwrap();
    assert_eq!(pinned.pins.len(), 1);
    let unlinked = tauri::async_runtime::block_on(remove_workspace_folder(
        handle.clone(),
        dup_add.id.clone(),
        folder_id.clone(),
    ))
    .unwrap();
    assert_eq!(unlinked.folders.len(), 1);
    assert!(unlinked.folders.iter().all(|folder| folder.id != folder_id));
    assert!(unlinked.pins.is_empty());
    let missing_folder = tauri::async_runtime::block_on(remove_workspace_folder(
        handle.clone(),
        dup_add.id.clone(),
        folder_id,
    ));
    assert!(missing_folder
        .unwrap_err()
        .contains("Unknown workspace folder"));

    let file_path = temp.path().join("plain.txt");
    std::fs::write(&file_path, b"hello").unwrap();
    let file_add_err = tauri::async_runtime::block_on(add_workspace(
        handle.clone(),
        file_path.to_string_lossy().into(),
    ))
    .unwrap_err();
    assert!(file_add_err.contains("not a folder"));

    let parent_ws =
        tauri::async_runtime::block_on(create_workspace(handle.clone(), "Parent".into())).unwrap();
    let child_ws =
        tauri::async_runtime::block_on(create_workspace(handle.clone(), "Child".into())).unwrap();
    let mut list = read_workspaces(handle).unwrap();
    list.iter_mut()
        .find(|w| w.id == child_ws.id)
        .unwrap()
        .parent_id = Some(parent_ws.id.clone());
    write_workspaces(handle, &list).unwrap();
    tauri::async_runtime::block_on(remove_workspace(handle.clone(), parent_ws.id)).unwrap();
    let remaining = read_workspaces(handle).unwrap();
    assert_eq!(
        remaining
            .iter()
            .find(|w| w.id == child_ws.id)
            .unwrap()
            .parent_id,
        None
    );

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
    let rdp_res = tauri::async_runtime::block_on(run_script(
        handle.clone(),
        dup_add.id.clone(),
        Some(rdp_script),
        None,
    ));
    if cfg!(any(target_os = "windows", target_os = "macos")) {
        assert!(rdp_res.is_ok());
    } else {
        assert!(rdp_res.is_err());
    }

    if let Ok(path) = workspaces_file(app.handle()) {
        let _ = std::fs::remove_file(path);
    }
}

#[test]
fn workspace_paths_are_stored_without_windows_verbatim_prefix() {
    let temp = tempfile::tempdir().unwrap();
    let path = canonical_dir(temp.path().to_string_lossy().as_ref()).unwrap();

    assert_eq!(
        path,
        dunce::canonicalize(temp.path()).unwrap().to_string_lossy()
    );
    assert!(!path.starts_with(r"\\?\"));
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
    assert_eq!(workspace.folders[0].path, "/");
    if let Ok(path) = workspaces_file(app.handle()) {
        let _ = std::fs::remove_file(path);
    }
}
