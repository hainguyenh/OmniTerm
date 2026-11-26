//! A panic while a session lock is held poisons it; the manager must report that instead of
//! panicking in turn, and keep serving the rest of the session where it can.

use super::*;

fn poison<T: Send>(mutex: &Mutex<T>) {
    std::thread::scope(|scope| {
        let joined = scope
            .spawn(|| {
                let _guard = mutex.lock().expect("lock must be healthy before poisoning");
                panic!("poisoning the lock on purpose");
            })
            .join();
        assert!(joined.is_err(), "the poisoning thread must panic");
    });
    assert!(mutex.is_poisoned());
}

fn started(dir: &std::path::Path) -> (SessionManager, Arc<Session>) {
    #[cfg(windows)]
    let exe = "cmd.exe".to_string();
    #[cfg(not(windows))]
    let exe = "/bin/sh".to_string();
    let launch = LaunchSpec {
        exe,
        args: Vec::new(),
        cwd: None,
        env: Vec::new(),
        label: "lock-test".into(),
        launched_with_command: false,
        ssh: false,
    };
    let manager = SessionManager::new(dir.to_path_buf()).expect("manager must start");
    manager
        .create("gui", "r", "s", 1, PersistencePolicy::KeepRunning, launch)
        .expect("shell session must start");
    let session = Arc::clone(&manager.sessions.get("s").expect("session must be listed"));
    (manager, session)
}

fn kill(session: &Session) {
    let mut killer = session
        .killer
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let _ = killer.kill();
}

fn error_of<T>(result: Result<T, String>) -> String {
    match result {
        Ok(_) => panic!("expected an error"),
        Err(error) => error,
    }
}

#[tokio::test]
async fn a_poisoned_output_lock_fails_attach_but_not_input() {
    let dir = tempfile::tempdir().unwrap();
    let (manager, session) = started(dir.path());
    poison(&session.output);
    assert_eq!(
        error_of(manager.attach("gui", "s")),
        "Session output lock is poisoned"
    );
    manager.input("s", "echo still-typing\n").unwrap();
    // Activity cannot be read back, so nothing is recorded.
    manager.update_activity("s", true);
    manager.disconnect("s").unwrap();
}

#[tokio::test]
async fn poisoned_writer_and_master_locks_fail_input_and_resize() {
    let dir = tempfile::tempdir().unwrap();
    let (manager, session) = started(dir.path());
    poison(&session.writer);
    poison(&session.master);
    assert_eq!(
        error_of(manager.input("s", "x")),
        "Session writer lock is poisoned"
    );
    assert_eq!(
        error_of(manager.resize("s", 100, 30)),
        "Session master lock is poisoned"
    );
    manager.disconnect("s").unwrap();
}

#[tokio::test]
async fn a_poisoned_killer_lock_fails_disconnect() {
    let dir = tempfile::tempdir().unwrap();
    let (manager, session) = started(dir.path());
    poison(&session.killer);
    assert_eq!(
        error_of(manager.disconnect("s")),
        "Session killer lock is poisoned"
    );
    kill(&session);
}

#[tokio::test]
async fn a_poisoned_policy_lock_fails_set_policy() {
    let dir = tempfile::tempdir().unwrap();
    let (manager, session) = started(dir.path());
    poison(&session.policy);
    let result = manager.set_policy("gui", "s", PersistencePolicy::RecoverAfterReboot);
    assert_eq!(error_of(result), "Session policy lock is poisoned");
    manager.disconnect("s").unwrap();
}

#[tokio::test]
async fn a_poisoned_owner_lock_keeps_the_session_but_drops_ownership() {
    let dir = tempfile::tempdir().unwrap();
    let (manager, session) = started(dir.path());
    poison(&session.owner_client);
    // Attach and policy changes still work; they just cannot record the new owner.
    manager.attach("other", "s").unwrap();
    manager
        .set_policy("other", "s", PersistencePolicy::CloseWithApp)
        .unwrap();
    // No client can be proven to own the session, so a client leaving keeps it running.
    assert!(!manager.client_disconnected("gui"));
    assert_eq!(manager.list().len(), 1);
    manager.disconnect("s").unwrap();
}

#[tokio::test]
async fn a_poisoned_lifecycle_lock_counts_as_failed_and_is_replaced_on_create() {
    let dir = tempfile::tempdir().unwrap();
    let (manager, session) = started(dir.path());
    poison(&session.lifecycle);
    // An unreadable lifecycle is not proof the session is finished.
    assert!(!manager.is_idle());
    let launch = session.launch.clone();
    let replaced = manager
        .create("gui", "r2", "s", 2, PersistencePolicy::KeepRunning, launch)
        .unwrap();
    assert_eq!(replaced.generation, 2);
    kill(&session);
    manager.disconnect("s").unwrap();
}

#[test]
fn a_poisoned_creation_guard_fails_create() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let guard = Arc::new(Mutex::new(()));
    manager.create_guards.insert("s".into(), Arc::clone(&guard));
    poison(&guard);
    let launch = LaunchSpec {
        exe: "unused".into(),
        args: Vec::new(),
        cwd: None,
        env: Vec::new(),
        label: "never-started".into(),
        launched_with_command: false,
        ssh: false,
    };
    let result = manager.create("gui", "r", "s", 1, PersistencePolicy::KeepRunning, launch);
    assert_eq!(error_of(result), "Session creation lock is poisoned");
    assert!(manager.list().is_empty());
}
