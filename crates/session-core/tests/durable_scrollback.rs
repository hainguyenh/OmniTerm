use std::time::Duration;

use session_core::{flush_recovery_scrollback, SessionManager};
use session_protocol::{LaunchSpec, PersistencePolicy};

fn one_shot(command: &str) -> LaunchSpec {
    #[cfg(windows)]
    let (exe, args) = ("cmd.exe".to_string(), vec!["/c".into(), command.into()]);
    #[cfg(not(windows))]
    let (exe, args) = ("/bin/sh".to_string(), vec!["-c".into(), command.into()]);
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
async fn reboot_generation_replays_durable_tail_before_new_output() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "gui",
            "r1",
            "session",
            1,
            PersistencePolicy::RecoverAfterReboot,
            one_shot("echo durable-marker"),
        )
        .unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    flush_recovery_scrollback(&manager).unwrap();
    drop(manager);

    let restarted = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let interrupted = restarted
        .list()
        .into_iter()
        .find(|session| session.id == "session")
        .expect("recover-after-reboot record should survive daemon restart");
    assert_eq!(interrupted.generation, 1);
    assert_eq!(interrupted.lifecycle, session_protocol::SessionLifecycle::Interrupted);
    assert_eq!(interrupted.policy, PersistencePolicy::RecoverAfterReboot);

    restarted
        .create(
            "gui-2",
            "r2",
            "session",
            2,
            PersistencePolicy::RecoverAfterReboot,
            one_shot("echo new-generation"),
        )
        .unwrap();
    let attached = restarted.attach("gui-2", "session").unwrap();
    assert!(String::from_utf8_lossy(&attached.replay).contains("durable-marker"));
    let _ = restarted.disconnect("session");
}
