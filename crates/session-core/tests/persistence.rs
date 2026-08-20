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
        .create(
            "gui",
            "request-1",
            "session",
            1,
            PersistencePolicy::KeepRunning,
            shell_launch("echo ready"),
        )
        .unwrap();
    let second = manager
        .create(
            "gui",
            "request-1",
            "session",
            1,
            PersistencePolicy::KeepRunning,
            shell_launch("echo ignored"),
        )
        .unwrap();
    assert_eq!(first.pid, second.pid);
    manager.disconnect("session").unwrap();
}

#[tokio::test]
async fn persistent_session_survives_client_lease_loss() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "gui",
            "r1",
            "session",
            1,
            PersistencePolicy::KeepRunning,
            shell_launch("echo alive"),
        )
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
        .create(
            "gui",
            "r1",
            "session",
            1,
            PersistencePolicy::CloseWithApp,
            shell_launch("echo closing"),
        )
        .unwrap();
    manager.client_disconnected("gui");
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(manager
        .list()
        .iter()
        .all(|item| item.id != "session" || item.lifecycle != SessionLifecycle::Live));
}

#[tokio::test]
async fn attach_replays_buffer_before_new_stream_events() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "gui",
            "r1",
            "session",
            1,
            PersistencePolicy::KeepRunning,
            shell_launch("echo marker"),
        )
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
        .create(
            "gui",
            "r1",
            "session",
            1,
            PersistencePolicy::KeepRunning,
            shell_launch("exit"),
        )
        .unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let restored = manager
        .create(
            "gui-2",
            "r2",
            "session",
            2,
            PersistencePolicy::RecoverAfterReboot,
            shell_launch("echo restored"),
        )
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

#[tokio::test]
async fn set_policy_changes_live_session_policy_and_owner() {
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
    manager
        .set_policy(
            "other-gui",
            "session",
            PersistencePolicy::RecoverAfterReboot,
        )
        .unwrap();
    assert_eq!(
        manager.list()[0].policy,
        PersistencePolicy::RecoverAfterReboot
    );
    manager.disconnect("session").unwrap();
}

#[test]
fn set_policy_returns_error_for_missing_session() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    assert!(manager
        .set_policy("gui", "nonexistent", PersistencePolicy::KeepRunning)
        .is_err());
}

#[test]
fn manifest_with_wrong_version_is_skipped_not_quarantined() {
    let dir = tempfile::tempdir().unwrap();
    let manifests = dir.path().join("sessions");
    std::fs::create_dir_all(&manifests).unwrap();
    let stale = serde_json::json!({"version": 0, "id": "stale", "generation": 1, "policy": "keep-running",
            "lifecycle": "live", "label": "stale", "busy": false,
            "launchedWithCommand": false, "ssh": false});
    std::fs::write(manifests.join("stale.json"), stale.to_string()).unwrap();

    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    assert!(manager.list().is_empty());
    let names: Vec<_> = std::fs::read_dir(manifests)
        .unwrap()
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    // Wrong-version manifests are silently skipped (not quarantined like corrupt JSON).
    assert!(names.iter().any(|name| name == "stale.json"));
    assert!(!names.iter().any(|name| name.starts_with("stale.corrupt-")));
}

fn seed_interrupted_manifest(state_dir: &std::path::Path, id: &str) {
    let manifests = state_dir.join("sessions");
    std::fs::create_dir_all(&manifests).unwrap();
    let manifest = serde_json::json!({
        "version": 1,
        "id": id,
        "generation": 1,
        "policy": "recover-after-reboot",
        "lifecycle": "interrupted",
        "label": "test",
        "busy": false,
        "launchedWithCommand": false,
        "ssh": false
    });
    // `load_interrupted` reads every file in the sessions directory regardless
    // of name, so any filename works; it will rewrite the record to the
    // hash-based canonical path on load.
    std::fs::write(manifests.join(format!("{id}.json")), manifest.to_string()).unwrap();
}

#[test]
fn interrupted_session_disconnect_removes_the_interrupted_record() {
    let dir = tempfile::tempdir().unwrap();
    seed_interrupted_manifest(dir.path(), "interrupted-1");

    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    assert_eq!(manager.list().len(), 1);
    assert_eq!(manager.list()[0].id, "interrupted-1");

    // Disconnect on an interrupted (not live) session drops its record and
    // manifest without spawning or killing a process.
    manager.disconnect("interrupted-1").unwrap();
    assert!(manager.list().is_empty());
}

#[test]
fn interrupted_session_set_policy_rewrites_the_manifest_record() {
    let dir = tempfile::tempdir().unwrap();
    seed_interrupted_manifest(dir.path(), "interrupted-2");

    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    assert_eq!(
        manager.list()[0].policy,
        PersistencePolicy::RecoverAfterReboot
    );

    // set_policy on an interrupted session rewrites its manifest with the new
    // policy and, when switching away from RecoverAfterReboot, removes any
    // durable scrollback.
    manager
        .set_policy("gui", "interrupted-2", PersistencePolicy::KeepRunning)
        .unwrap();
    assert_eq!(manager.list()[0].policy, PersistencePolicy::KeepRunning);
}
