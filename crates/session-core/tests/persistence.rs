use std::time::Duration;

use session_core::SessionManager;
use session_protocol::{LaunchSpec, PersistencePolicy, SessionLifecycle};

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
fn corrupt_manifest_is_quarantined_without_blocking_daemon_start() {
    let dir = tempfile::tempdir().unwrap();
    let manifests = dir.path().join("sessions");
    std::fs::create_dir_all(&manifests).unwrap();
    std::fs::write(manifests.join("broken.json"), b"{not-json").unwrap();

    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();

    assert!(manager.list().is_empty());
    let names: Vec<_> = std::fs::read_dir(manifests)
        .unwrap()
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    assert!(names.iter().any(|name| name.starts_with("broken.corrupt-")));
    assert!(!names.iter().any(|name| name == "broken.json"));
}

#[tokio::test]
async fn duplicate_create_request_does_not_spawn_a_second_process() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let first = manager
        .create("gui", "request-1", "session", 1, PersistencePolicy::KeepRunning, shell_launch("echo ready"))
        .unwrap();
    let second = manager
        .create("gui", "request-1", "session", 1, PersistencePolicy::KeepRunning, shell_launch("echo ignored"))
        .unwrap();
    assert_eq!(first.pid, second.pid);
    manager.disconnect("session").unwrap();
}

#[tokio::test]
async fn persistent_session_survives_client_lease_loss() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create("gui", "r1", "session", 1, PersistencePolicy::KeepRunning, shell_launch("echo alive"))
        .unwrap();
    manager.client_disconnected("gui");
    assert_eq!(manager.list()[0].lifecycle, SessionLifecycle::Live);
    manager.disconnect("session").unwrap();
}

#[tokio::test]
async fn close_with_app_session_dies_when_its_client_lease_is_lost() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create("gui", "r1", "session", 1, PersistencePolicy::CloseWithApp, shell_launch("echo closing"))
        .unwrap();
    manager.client_disconnected("gui");
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(manager.list().iter().all(|item| item.id != "session" || item.lifecycle != SessionLifecycle::Live));
}

#[tokio::test]
async fn attach_replays_buffer_before_new_stream_events() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create("gui", "r1", "session", 1, PersistencePolicy::KeepRunning, shell_launch("echo marker"))
        .unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let attached = manager.attach("gui-2", "session").unwrap();
    assert!(String::from_utf8_lossy(&attached.replay).contains("marker"));
    manager.disconnect("session").unwrap();
}

#[tokio::test]
async fn closed_session_id_can_be_recreated_with_a_new_generation() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create("gui", "r1", "session", 1, PersistencePolicy::KeepRunning, shell_launch("exit"))
        .unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let restored = manager
        .create("gui-2", "r2", "session", 2, PersistencePolicy::RecoverAfterReboot, shell_launch("echo restored"))
        .unwrap();
    assert_eq!(restored.generation, 2);
    assert_eq!(restored.lifecycle, SessionLifecycle::Live);
    manager.disconnect("session").unwrap();
}


#[tokio::test]
async fn explicit_disconnect_cannot_be_resurrected_by_the_exit_watcher() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "gui",
            "r-close",
            "session",
            1,
            PersistencePolicy::RecoverAfterReboot,
            shell_launch("echo alive"),
        )
        .unwrap();

    manager.disconnect("session").unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    drop(manager);

    let restarted = SessionManager::new(dir.path().to_path_buf()).unwrap();
    assert!(restarted.list().iter().all(|item| item.id != "session"));
}

#[tokio::test]
async fn durable_manifest_never_persists_launch_command_or_environment_values() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let mut launch = shell_launch("echo manifest-secret-command");
    launch
        .env
        .push(("OMNITERM_TEST_TOKEN".into(), "manifest-secret-value".into()));
    manager
        .create(
            "gui",
            "r-secret",
            "session-secret",
            1,
            PersistencePolicy::RecoverAfterReboot,
            launch,
        )
        .unwrap();

    let manifest_dir = dir.path().join("sessions");
    let manifest_path = std::fs::read_dir(manifest_dir)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let manifest = std::fs::read_to_string(manifest_path).unwrap();
    assert!(!manifest.contains("manifest-secret-command"));
    assert!(!manifest.contains("manifest-secret-value"));
    assert!(!manifest.contains("OMNITERM_TEST_TOKEN"));
    manager.disconnect("session-secret").unwrap();
}
