use std::time::Duration;

use session_core::SessionManager;
use session_protocol::{LaunchSpec, PersistencePolicy};

fn shell_launch(command: &str) -> LaunchSpec {
    #[cfg(windows)]
    let (exe, args) = ("cmd.exe".to_string(), vec!["/k".into(), command.into()]);
    #[cfg(not(windows))]
    let (exe, args) = (
        "/bin/sh".to_string(),
        vec!["-c".into(), format!("{command}; exec /bin/sh")],
    );
    LaunchSpec {
        exe,
        args,
        cwd: None,
        env: vec![("TERM".into(), "xterm-256color".into())],
        label: "test-shell".into(),
        launched_with_command: true,
        ssh: false,
    }
}

#[tokio::test]
async fn input_writes_data_to_live_session() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "gui",
            "r1",
            "session",
            1,
            PersistencePolicy::KeepRunning,
            shell_launch("echo ready"),
        )
        .unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    manager.input("session", "echo test\r").unwrap();
    manager.disconnect("session").unwrap();
}

#[test]
fn input_returns_error_for_missing_session() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    assert!(manager.input("nonexistent", "data").is_err());
}

#[tokio::test]
async fn resize_updates_terminal_dimensions_on_live_session() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "gui",
            "r1",
            "session",
            1,
            PersistencePolicy::KeepRunning,
            shell_launch("echo ready"),
        )
        .unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(manager.resize("session", 120, 40).is_ok());
    manager.disconnect("session").unwrap();
}

#[test]
fn resize_rejects_zero_dimensions_without_a_runtime() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    assert!(manager.resize("any", 0, 24).is_err());
    assert!(manager.resize("any", 80, 0).is_err());
}

#[test]
fn resize_returns_error_for_missing_session() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    assert!(manager.resize("nonexistent", 80, 24).is_err());
}
