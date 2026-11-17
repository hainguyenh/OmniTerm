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
    // Wait for the shell's first output rather than a fixed delay, which is too short when
    // many test shells start at once.
    for _ in 0..100 {
        let replay = manager
            .sessions
            .get("session")
            .and_then(|session| session.output.lock().ok().map(|output| output.replay()))
            .unwrap_or_default();
        if !replay.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    flush(&manager).unwrap();
    assert!(!load(dir.path(), "session").is_empty());
    remove(dir.path(), "session");
    assert!(load(dir.path(), "session").is_empty());
    manager.disconnect("session").unwrap();
}

fn recoverable(dir: &std::path::Path) -> SessionManager {
    let manager = SessionManager::new(dir.to_path_buf()).unwrap();
    manager
        .create(
            "gui",
            "r1",
            "session",
            1,
            PersistencePolicy::RecoverAfterReboot,
            shell_launch("echo kept"),
        )
        .unwrap();
    manager
        .sessions
        .get("session")
        .expect("session must exist")
        .output
        .lock()
        .expect("output lock must be healthy")
        .push(b"durable-bytes");
    manager
}

#[tokio::test]
async fn flush_skips_a_session_whose_output_did_not_change() {
    let dir = tempfile::tempdir().unwrap();
    let manager = recoverable(dir.path());
    // Let the shell finish printing so only this test changes the output.
    let revision = || {
        manager
            .sessions
            .get("session")
            .and_then(|session| session.output.lock().ok()?.take_flush_snapshot())
            .map(|(revision, _)| revision)
    };
    let mut last = revision();
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let now = revision();
        if now == last {
            break;
        }
        last = now;
    }
    flush(&manager).unwrap();
    let file = path(dir.path(), "session");
    std::fs::write(&file, b"sentinel").unwrap();
    flush(&manager).unwrap();
    assert_eq!(std::fs::read(&file).unwrap(), b"sentinel");
    manager.disconnect("session").unwrap();
}

#[tokio::test]
async fn flush_reports_an_uncreatable_scrollback_directory() {
    let dir = tempfile::tempdir().unwrap();
    let manager = recoverable(dir.path());
    std::fs::write(dir.path().join("scrollback"), b"not a directory").unwrap();
    let error = flush(&manager).unwrap_err();
    assert!(
        error.starts_with("Could not create durable scrollback directory"),
        "{error}"
    );
    manager.disconnect("session").unwrap();
}

#[tokio::test]
async fn flush_reports_a_failed_durable_write() {
    let dir = tempfile::tempdir().unwrap();
    let manager = recoverable(dir.path());
    // A directory where the scrollback file belongs makes the atomic commit fail.
    std::fs::create_dir_all(path(dir.path(), "session").join("blocker")).unwrap();
    let error = flush(&manager).unwrap_err();
    assert!(error.contains("durable terminal scrollback"), "{error}");
    manager.disconnect("session").unwrap();
}

#[tokio::test]
async fn flush_reports_a_poisoned_output_lock() {
    let dir = tempfile::tempdir().unwrap();
    let manager = recoverable(dir.path());
    let session = std::sync::Arc::clone(&manager.sessions.get("session").unwrap());
    std::thread::scope(|scope| {
        let joined = scope
            .spawn(|| {
                let _guard = session.output.lock().unwrap();
                panic!("poisoning the output lock on purpose");
            })
            .join();
        assert!(joined.is_err());
    });
    assert_eq!(
        flush(&manager).unwrap_err(),
        "Session output lock is poisoned"
    );
    manager.disconnect("session").unwrap();
}
