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
        label: "manager-ops-test".into(),
        launched_with_command: false,
        ssh: false,
    }
}

fn create(manager: &SessionManager, request: &str, id: &str) -> SessionSummary {
    manager
        .create(
            "gui",
            request,
            id,
            1,
            PersistencePolicy::KeepRunning,
            shell_launch("echo ready"),
        )
        .expect("shell session must start")
}

fn error_of<T>(result: Result<T, String>) -> String {
    match result {
        Ok(_) => panic!("expected an error"),
        Err(error) => error,
    }
}

#[tokio::test]
async fn create_reuses_the_live_session_for_a_repeated_request_or_session_id() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let first = create(&manager, "request-1", "session");

    // The same request (a retried IPC call) answers with the session it already made.
    let retried = manager
        .create(
            "gui",
            "request-1",
            "session",
            7,
            PersistencePolicy::KeepRunning,
            shell_launch("echo other"),
        )
        .unwrap();
    assert_eq!(retried.generation, 1);
    assert_eq!(retried.pid, first.pid);

    // A new request for a session that is still live does not restart it either.
    let again = create(&manager, "request-2", "session");
    assert_eq!(again.pid, first.pid);
    assert_eq!(manager.list().len(), 1);
    manager.disconnect("session").unwrap();
}

#[tokio::test]
async fn create_starts_a_new_session_when_the_request_belongs_to_another_one() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    create(&manager, "request-1", "first");
    let second = create(&manager, "request-1", "second");
    assert_eq!(second.id, "second");
    let ids: Vec<_> = manager.list().into_iter().map(|item| item.id).collect();
    assert_eq!(ids, ["first", "second"]);
    assert!(manager.client_disconnected("gui"));
    assert!(manager.list().is_empty());
}

#[tokio::test]
async fn create_applies_cwd_and_env_and_reports_launch_failures() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().join("state")).unwrap();
    let mut launch = shell_launch("echo ready");
    launch.cwd = Some(dir.path().to_string_lossy().into_owned());
    launch.env = vec![("OMNITERM_TEST".into(), "1".into())];
    manager
        .create(
            "gui",
            "r1",
            "cwd",
            1,
            PersistencePolicy::KeepRunning,
            launch,
        )
        .unwrap();
    manager.disconnect("cwd").unwrap();

    let mut missing_cwd = shell_launch("echo ready");
    missing_cwd.cwd = Some(dir.path().join("absent").to_string_lossy().into_owned());
    let error = error_of(manager.create(
        "gui",
        "r2",
        "bad-cwd",
        1,
        PersistencePolicy::KeepRunning,
        missing_cwd,
    ));
    assert!(
        error.starts_with("Could not resolve working directory"),
        "{error}"
    );

    let mut missing_exe = shell_launch("echo ready");
    missing_exe.exe = dir
        .path()
        .join("no-such-shell-binary")
        .to_string_lossy()
        .into_owned();
    let error = error_of(manager.create(
        "gui",
        "r3",
        "bad-exe",
        1,
        PersistencePolicy::KeepRunning,
        missing_exe,
    ));
    assert!(error.starts_with("Could not start"), "{error}");
    assert!(manager.list().is_empty());
}

#[tokio::test]
async fn a_recovered_generation_replays_the_durable_scrollback() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let recover = PersistencePolicy::RecoverAfterReboot;
    manager
        .create("gui", "r1", "s", 1, recover, shell_launch("echo one"))
        .unwrap();
    let old = Arc::clone(&manager.sessions.get("s").expect("session must exist"));
    old.output
        .lock()
        .expect("output lock must be healthy")
        .push(b"seeded-marker");
    crate::scrollback::flush(&manager).unwrap();
    // Drop the first generation without the disconnect cleanup, as a reboot would.
    manager.sessions.remove("s");
    let _ = old
        .killer
        .lock()
        .expect("killer lock must be healthy")
        .kill();

    manager
        .create("gui", "r2", "s", 2, recover, shell_launch("echo two"))
        .unwrap();
    let attached = manager.attach("gui", "s").unwrap();
    assert!(String::from_utf8_lossy(&attached.replay).contains("seeded-marker"));
    assert_eq!(attached.snapshot.generation, 2);
    manager.disconnect("s").unwrap();
}

#[tokio::test]
async fn session_operations_report_unknown_sessions_and_invalid_sizes() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    assert_eq!(error_of(manager.attach("gui", "nope")), "Session not found");
    assert_eq!(error_of(manager.input("nope", "x")), "Session not found");
    assert_eq!(
        error_of(manager.resize("nope", 80, 24)),
        "Session not found"
    );
    assert_eq!(error_of(manager.disconnect("nope")), "Session not found");
    let not_found = manager.set_policy("gui", "nope", PersistencePolicy::KeepRunning);
    assert_eq!(error_of(not_found), "Session not found");
    let zero = "Terminal size must be non-zero";
    assert_eq!(error_of(manager.resize("nope", 0, 24)), zero);
    assert_eq!(error_of(manager.resize("nope", 80, 0)), zero);
}

#[tokio::test]
async fn a_live_session_accepts_input_resize_and_policy_changes() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    assert!(manager.is_idle());
    create(&manager, "r1", "s");
    assert!(!manager.is_idle());
    manager.input("s", "echo typed\n").unwrap();
    manager.resize("s", 120, 40).unwrap();
    for policy in [
        PersistencePolicy::RecoverAfterReboot,
        PersistencePolicy::CloseWithApp,
    ] {
        manager.set_policy("other", "s", policy).unwrap();
        assert_eq!(manager.list()[0].policy, policy);
    }
    // set_policy hands ownership to the caller, so the old owner leaving keeps the session.
    assert!(!manager.client_disconnected("gui"));
    assert_eq!(manager.list().len(), 1);
    assert!(manager.client_disconnected("other"));
    assert!(manager.is_idle());
}
