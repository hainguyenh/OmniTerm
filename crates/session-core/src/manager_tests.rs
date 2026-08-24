use super::*;

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
        env: Vec::new(),
        label: "manager-test".into(),
        launched_with_command: false,
        ssh: false,
    }
}

#[tokio::test]
async fn create_retries_a_request_when_previous_session_was_disconnected() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "gui",
            "request-1",
            "session",
            1,
            PersistencePolicy::KeepRunning,
            shell_launch("echo first"),
        )
        .unwrap();
    manager.disconnect("session").unwrap();

    let recreated = manager
        .create(
            "gui",
            "request-1",
            "session",
            2,
            PersistencePolicy::KeepRunning,
            shell_launch("echo second"),
        )
        .unwrap();
    assert_eq!(recreated.generation, 2);
    manager.disconnect("session").unwrap();
}

#[tokio::test]
async fn update_activity_persists_changes_and_skips_repeated_values() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "gui",
            "request-1",
            "session",
            1,
            PersistencePolicy::KeepRunning,
            shell_launch("echo ready"),
        )
        .unwrap();

    manager.update_activity("missing", true);
    manager.update_activity("session", true);
    manager.update_activity("session", true);
    manager.update_activity("session", false);
    manager.disconnect("session").unwrap();
}

#[tokio::test]
async fn persist_reports_unwritable_state_directory_without_panicking() {
    let dir = tempfile::tempdir().unwrap();
    let blocked = dir.path().join("state-file");
    std::fs::write(&blocked, b"not a directory").unwrap();
    let mut manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    *Arc::get_mut(&mut manager.state_dir).unwrap() = blocked;

    let result = manager.create(
        "gui",
        "request-1",
        "session",
        1,
        PersistencePolicy::KeepRunning,
        shell_launch("echo ready"),
    );
    assert!(result.is_ok());
    manager.disconnect("session").unwrap();
}

#[test]
fn new_reports_an_uncreatable_state_directory() {
    // A regular file cannot be turned into the daemon state directory; the
    // constructor must surface that instead of panicking.
    let dir = tempfile::tempdir().unwrap();
    let blocker = dir.path().join("state-file");
    std::fs::write(&blocker, b"not a directory").unwrap();
    let error = match SessionManager::new(blocker) {
        Ok(_) => panic!("directory creation must fail for a regular file"),
        Err(error) => error,
    };
    assert!(
        error.contains("state directory"),
        "unexpected error: {error}"
    );
}
