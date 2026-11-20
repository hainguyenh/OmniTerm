use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use session_protocol::{LaunchSpec, PersistencePolicy};

use crate::manager::SessionManager;

fn shell(args: &[&str]) -> LaunchSpec {
    #[cfg(windows)]
    let exe = "cmd.exe".to_string();
    #[cfg(not(windows))]
    let exe = "/bin/sh".to_string();
    LaunchSpec {
        exe,
        args: args.iter().map(|arg| (*arg).to_string()).collect(),
        cwd: None,
        env: Vec::new(),
        label: "exit-test".into(),
        launched_with_command: false,
        ssh: false,
    }
}

fn exiting_shell() -> LaunchSpec {
    #[cfg(windows)]
    let args = ["/c", "exit 3"];
    #[cfg(not(windows))]
    let args = ["-c", "exit 3"];
    shell(&args)
}

/// The lifecycle recorded in the only manifest on disk, once it differs from "live".
async fn persisted_lifecycle(state_dir: &Path) -> String {
    for _ in 0..250 {
        let lifecycle = std::fs::read_dir(state_dir.join("sessions"))
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
            .filter_map(|entry| std::fs::read(entry.path()).ok())
            .filter_map(|data| serde_json::from_slice::<serde_json::Value>(&data).ok())
            .find_map(|manifest| manifest["lifecycle"].as_str().map(str::to_string));
        if let Some(lifecycle) = lifecycle.filter(|value| value != "live") {
            return lifecycle;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the exit watcher never persisted a final lifecycle");
}

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
}

#[tokio::test]
async fn a_shell_that_exits_is_persisted_as_closed() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "gui",
            "r",
            "s",
            1,
            PersistencePolicy::KeepRunning,
            exiting_shell(),
        )
        .unwrap();
    assert_eq!(persisted_lifecycle(dir.path()).await, "closed");
    assert_eq!(
        manager.list()[0].lifecycle,
        session_protocol::SessionLifecycle::Closed
    );
    assert!(manager.is_idle());
}

#[tokio::test]
async fn an_exit_with_poisoned_session_locks_is_persisted_as_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "gui",
            "r",
            "s",
            1,
            PersistencePolicy::KeepRunning,
            shell(&[]),
        )
        .unwrap();
    let session = std::sync::Arc::clone(&manager.sessions.get("s").unwrap());
    poison(&session.lifecycle);
    poison(&session.output);
    manager.input("s", "exit\r\n").unwrap();
    // The watcher cannot mark the session closed, so its manifest falls back to an error.
    assert_eq!(persisted_lifecycle(dir.path()).await, "error");
}
