use super::*;
use crate::test_support;
use tauri::Manager;

#[test]
fn manager_defaults_empty_and_missing_session_commands_fail_cleanly() {
    let app = test_support::mock_app();
    assert!(app.manage(PtyManager::new()));
    let manager = app.state::<PtyManager>();
    assert!(manager.sessions.is_empty());

    assert_eq!(
        tauri::async_runtime::block_on(send_session_input(
            manager.clone(),
            "missing".to_string(),
            "data".to_string(),
        ))
        .unwrap_err(),
        "Session not found"
    );
    assert_eq!(
        tauri::async_runtime::block_on(resize_session(
            manager.clone(),
            "missing".to_string(),
            0,
            24,
        ))
        .unwrap_err(),
        "Terminal size must be non-zero"
    );
    assert_eq!(
        tauri::async_runtime::block_on(resize_session(
            manager.clone(),
            "missing".to_string(),
            80,
            24,
        ))
        .unwrap_err(),
        "Session not found"
    );
    assert_eq!(
        tauri::async_runtime::block_on(disconnect_session(
            manager.clone(),
            "missing".to_string(),
        ))
        .unwrap_err(),
        "Session not found"
    );

    kill_session(&manager, "missing");
    assert!(manager.sessions.is_empty());
}

#[test]
fn pane_path_prepends_the_launcher_directory_and_preserves_existing_path() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let original = std::env::var_os("PATH");
    std::env::set_var("PATH", std::env::join_paths(["/one", "/two"]).unwrap());

    let combined = path_with_helper(&handle).expect("PATH should be composed");
    let parts = std::env::split_paths(&combined).collect::<Vec<_>>();
    assert_eq!(parts.first(), Some(&launcher::launcher_bin_dir(&handle)));
    assert!(parts.iter().any(|path| path == std::path::Path::new("/one")));
    assert!(parts.iter().any(|path| path == std::path::Path::new("/two")));

    match original {
        Some(value) => std::env::set_var("PATH", value),
        None => std::env::remove_var("PATH"),
    }
}

#[test]
fn pane_path_is_none_when_path_is_absent() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let original = std::env::var_os("PATH");
    std::env::remove_var("PATH");
    assert!(path_with_helper(&handle).is_none());
    if let Some(value) = original {
        std::env::set_var("PATH", value);
    }
}
