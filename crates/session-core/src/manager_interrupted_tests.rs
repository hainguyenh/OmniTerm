use super::*;

fn interrupted_manager(dir: &std::path::Path, ids: &[&str]) -> SessionManager {
    for id in ids {
        let record = SessionManifest::live(
            (*id).to_string(),
            3,
            PersistencePolicy::KeepRunning,
            format!("label-{id}"),
            false,
            false,
            false,
        );
        manifest::write(dir, &record).expect("manifest must be written");
    }
    SessionManager::new(dir.to_path_buf()).expect("manager must load manifests")
}

#[test]
fn interrupted_sessions_are_listed_and_keep_the_daemon_busy() {
    let dir = tempfile::tempdir().unwrap();
    let manager = interrupted_manager(dir.path(), &["b", "a"]);
    let listed = manager.list();
    let ids: Vec<_> = listed.iter().map(|item| item.id.as_str()).collect();
    assert_eq!(ids, ["a", "b"]);
    assert!(listed
        .iter()
        .all(|item| item.lifecycle == SessionLifecycle::Interrupted && item.generation == 3));
    assert!(!manager.is_idle());
}

#[test]
fn set_policy_updates_an_interrupted_record_on_disk() {
    let dir = tempfile::tempdir().unwrap();
    let manager = interrupted_manager(dir.path(), &["a"]);
    manager
        .set_policy("gui", "a", PersistencePolicy::RecoverAfterReboot)
        .unwrap();
    assert_eq!(
        manager.list()[0].policy,
        PersistencePolicy::RecoverAfterReboot
    );
    // A recoverable interrupted record survives the next daemon start.
    let reloaded = manifest::load_interrupted(dir.path());
    assert_eq!(reloaded.len(), 1);
    assert_eq!(reloaded[0].policy, PersistencePolicy::RecoverAfterReboot);

    manager
        .set_policy("gui", "a", PersistencePolicy::CloseWithApp)
        .unwrap();
    assert_eq!(manager.list()[0].policy, PersistencePolicy::CloseWithApp);
    // Once it closes with the app, an interrupted record is not restored again.
    assert!(manifest::load_interrupted(dir.path()).is_empty());
}

#[test]
fn disconnecting_an_interrupted_session_forgets_it() {
    let dir = tempfile::tempdir().unwrap();
    let manager = interrupted_manager(dir.path(), &["a"]);
    manager.disconnect("a").unwrap();
    assert!(manager.list().is_empty());
    assert!(manager.is_idle());
    assert!(manifest::load_interrupted(dir.path()).is_empty());
    assert_eq!(
        manager.disconnect("a"),
        Err("Session not found".to_string())
    );
}

#[tokio::test]
async fn a_live_session_hides_its_interrupted_record_from_the_list() {
    let dir = tempfile::tempdir().unwrap();
    let manager = interrupted_manager(dir.path(), &["a"]);
    let record = manager
        .interrupted
        .get("a")
        .map(|entry| entry.clone())
        .expect("the manifest must load as interrupted");
    let launch = LaunchSpec {
        #[cfg(windows)]
        exe: "cmd.exe".into(),
        #[cfg(not(windows))]
        exe: "/bin/sh".into(),
        args: Vec::new(),
        cwd: None,
        env: Vec::new(),
        label: "live".into(),
        launched_with_command: false,
        ssh: false,
    };
    manager
        .create("gui", "r", "a", 4, PersistencePolicy::KeepRunning, launch)
        .unwrap();
    // Re-insert the record create cleared, as a racing restore would.
    manager.interrupted.insert("a".into(), record);
    let listed = manager.list();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].generation, 4);
    assert_eq!(listed[0].lifecycle, SessionLifecycle::Live);
    manager.disconnect("a").unwrap();
}

#[test]
fn set_policy_reports_an_interrupted_record_that_cannot_be_saved() {
    let dir = tempfile::tempdir().unwrap();
    let mut manager = interrupted_manager(dir.path(), &["a"]);
    let blocked = dir.path().join("state-file");
    std::fs::write(&blocked, b"not a directory").unwrap();
    *Arc::get_mut(&mut manager.state_dir).expect("manager must not be shared yet") = blocked;
    let error = manager
        .set_policy("gui", "a", PersistencePolicy::RecoverAfterReboot)
        .unwrap_err();
    assert!(
        error.starts_with("Could not create session manifest directory"),
        "{error}"
    );
}
