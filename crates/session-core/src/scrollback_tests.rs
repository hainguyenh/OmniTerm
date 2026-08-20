use super::*;
use std::time::Duration;

use crate::manager::SessionManager;
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

#[test]
fn load_returns_empty_when_no_scrollback_exists() {
    let dir = tempfile::tempdir().unwrap();
    assert!(load(dir.path(), "missing").is_empty());
}

#[tokio::test]
async fn flush_writes_recover_after_reboot_session_scrollback_to_disk() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "gui",
            "r1",
            "session",
            1,
            PersistencePolicy::RecoverAfterReboot,
            shell_launch("echo marker"),
        )
        .unwrap();
    let mut replay = Vec::new();
    for _ in 0..50 {
        replay = manager
            .sessions
            .get("session")
            .and_then(|session| session.output.lock().ok().map(|output| output.replay()))
            .unwrap_or_default();
        if String::from_utf8_lossy(&replay).contains("marker") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    flush(&manager).unwrap();

    let scrollback_dir = dir.path().join("scrollback");
    let files: Vec<_> = std::fs::read_dir(&scrollback_dir)
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    assert_eq!(files.len(), 1);
    assert!(String::from_utf8_lossy(&replay).contains("marker"));
    assert!(String::from_utf8_lossy(&load(dir.path(), "session")).contains("marker"));
    manager.disconnect("session").unwrap();
}

#[tokio::test]
async fn flush_skips_keep_running_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "gui",
            "r1",
            "session",
            1,
            PersistencePolicy::KeepRunning,
            shell_launch("echo skipped"),
        )
        .unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    flush(&manager).unwrap();

    let scrollback_dir = dir.path().join("scrollback");
    let files: Vec<_> = std::fs::read_dir(&scrollback_dir)
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    assert_eq!(files.len(), 0);
    manager.disconnect("session").unwrap();
}

#[tokio::test]
async fn remove_deletes_a_flushed_scrollback_file() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "gui",
            "r1",
            "session",
            1,
            PersistencePolicy::RecoverAfterReboot,
            shell_launch("echo bye"),
        )
        .unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    flush(&manager).unwrap();
    assert!(!load(dir.path(), "session").is_empty());
    remove(dir.path(), "session");
    assert!(load(dir.path(), "session").is_empty());
    manager.disconnect("session").unwrap();
}
