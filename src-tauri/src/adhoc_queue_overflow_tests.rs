//! Queue overflow, workspace-argument and cwd/command-override coverage for the adhoc quick-shell path. 
use super::*;
use super::tests::request;
use crate::test_support;
#[test]
fn quick_shell_with_workspace_and_queue_overflow_paths() {
    use crate::workspace::{Workspace, WorkspaceFolder};
    use tauri::Manager;

    let _guard = test_support::lock();
    let app = test_support::mock_app();
    assert!(app.manage(AdhocRegistry::new()));
    let handle = app.handle();

    let temp = tempfile::tempdir().unwrap();
    let valid_path = std::fs::canonicalize(temp.path())
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let normalized_path = dunce::canonicalize(temp.path())
        .unwrap()
        .to_string_lossy()
        .into_owned();

    let ws_valid = Workspace {
        id: "ws#valid".to_string(),
        name: "Valid".to_string(),
        folders: vec![WorkspaceFolder {
            id: "f1".into(),
            name: "F1".into(),
            path: valid_path.clone(),
            color: None,
        }],
        parent_id: None,
        order: 0,
        pins: Vec::new(),
        color: None,
        icon: None,
    };
    let ws_empty = Workspace {
        id: "ws#empty".to_string(),
        name: "Empty".to_string(),
        folders: Vec::new(),
        parent_id: None,
        order: 1,
        pins: Vec::new(),
        color: None,
        icon: None,
    };
    let ws_multi = Workspace {
        id: "ws#multi".to_string(),
        name: "Multi".to_string(),
        folders: vec![
            WorkspaceFolder {
                id: "f1".into(),
                name: "F1".into(),
                path: valid_path.clone(),
                color: None,
            },
            WorkspaceFolder {
                id: "f2".into(),
                name: "F2".into(),
                path: valid_path.clone(),
                color: None,
            },
        ],
        parent_id: None,
        order: 2,
        pins: Vec::new(),
        color: None,
        icon: None,
    };
    let ws_bad_dir = Workspace {
        id: "ws#baddir".to_string(),
        name: "Bad".to_string(),
        folders: vec![WorkspaceFolder {
            id: "f1".into(),
            name: "F1".into(),
            path: "/missing/folder/nowhere".into(),
            color: None,
        }],
        parent_id: None,
        order: 3,
        pins: Vec::new(),
        color: None,
        icon: None,
    };

    let _ = crate::workspace_persistence::write_workspaces(
        handle,
        &[ws_valid, ws_empty, ws_multi, ws_bad_dir],
    );

    assert!(tauri::async_runtime::block_on(open_quick_shell(
        handle.clone(),
        None,
        Some("ws#ghost".into()),
        None,
        None,
        None
    ))
    .unwrap_err()
    .contains("Unknown workspace"));
    assert!(tauri::async_runtime::block_on(open_quick_shell(
        handle.clone(),
        None,
        Some("ws#empty".into()),
        None,
        None,
        None
    ))
    .unwrap_err()
    .contains("Add a folder"));
    assert!(tauri::async_runtime::block_on(open_quick_shell(
        handle.clone(),
        None,
        Some("ws#multi".into()),
        None,
        None,
        None
    ))
    .unwrap_err()
    .contains("Choose a workspace"));
    assert!(tauri::async_runtime::block_on(open_quick_shell(
        handle.clone(),
        None,
        Some("ws#baddir".into()),
        None,
        None,
        None
    ))
    .unwrap_err()
    .contains("invalid"));
    let selected = tauri::async_runtime::block_on(open_quick_shell(
        handle.clone(),
        None,
        Some("ws#multi".into()),
        Some("f2".into()),
        None,
        None,
    ))
    .unwrap();
    assert_eq!(selected["localCwd"], normalized_path);

    let res = tauri::async_runtime::block_on(open_quick_shell(
        handle.clone(),
        None,
        Some("ws#valid".into()),
        None,
        None,
        None,
    ))
    .unwrap();
    assert_eq!(res["localCwd"], normalized_path);

    for _ in 0..MAX_PENDING_OPENS + 5 {
        open_adhoc_shell(handle, request());
    }

    if let Ok(path) = crate::workspace_persistence::workspaces_file(handle) {
        let _ = std::fs::remove_file(path);
    }
}

/// Renderer-supplied cwd/command overrides (the session-restore path): a real directory is
/// canonicalized into the payload, an agent resume command passes through, and anything invalid —
/// or past the argv cap — is refused or truncated the way the launcher argv path would.
#[test]
fn quick_shell_validates_renderer_cwd_and_command_overrides() {
    use tauri::Manager;

    let _guard = test_support::lock();
    let app = test_support::mock_app();
    assert!(app.manage(AdhocRegistry::new()));
    let handle = app.handle();
    // Every case opens the platform default shell with only the renderer overrides varying.
    let open = |cwd: Option<&str>, command: Option<&str>| {
        let (cwd, command) = (cwd.map(str::to_string), command.map(str::to_string));
        tauri::async_runtime::block_on(open_quick_shell(
            handle.clone(),
            None,
            None,
            None,
            cwd,
            command,
        ))
    };

    let temp = tempfile::tempdir().unwrap();
    let normalized_path = dunce::canonicalize(temp.path())
        .unwrap()
        .to_string_lossy()
        .into_owned();

    let payload = open(
        Some(&temp.path().to_string_lossy()),
        Some("claude --resume"),
    )
    .unwrap();
    assert_eq!(payload["localCwd"], json!(normalized_path));
    assert_eq!(payload["localCommand"], json!("claude --resume"));

    let err = open(Some("/missing/folder/nowhere"), None).unwrap_err();
    assert!(
        err.contains("invalid"),
        "a nonexistent cwd must be refused: {err}"
    );

    // Oversized input is capped to the same limit the launcher argv path enforces.
    let long_command = "a".repeat(5000);
    let payload = open(None, Some(&long_command)).unwrap();
    assert_eq!(
        payload["localCommand"].as_str().unwrap().chars().count(),
        4096
    );

    // Whitespace-only values are treated as absent, not as an override.
    let payload = open(Some("   "), Some("   ")).unwrap();
    assert_eq!(payload["localCwd"], json!(null));
    assert_eq!(payload["localCommand"], json!(null));
}
