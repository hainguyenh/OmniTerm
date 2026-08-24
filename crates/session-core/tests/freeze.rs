use std::time::Duration;

use session_core::SessionManager;
use session_protocol::{LaunchSpec, PersistencePolicy};

/// Emits one marker line, then blocks on stdin so the replay buffer is silent
/// until we deliberately feed input after the resume. This makes the freeze
/// assertions exact instead of timing-based.
fn periodic_output() -> LaunchSpec {
    #[cfg(windows)]
    let (exe, args) = (
        "cmd.exe".to_string(),
        vec!["/c".into(), "echo freeze-marker & more".into()],
    );
    #[cfg(not(windows))]
    let (exe, args) = (
        "/bin/sh".to_string(),
        vec!["-c".into(), "echo freeze-marker; cat".into()],
    );
    LaunchSpec {
        exe,
        args,
        cwd: None,
        env: vec![("TERM".into(), "xterm-256color".into())],
        label: "freeze-test".into(),
        launched_with_command: true,
        ssh: false,
    }
}

// Every probe attaches with the SAME client id that owns the session, so the
// ownership check in on_client_disconnected still matches afterwards.
fn replay_len(manager: &SessionManager, id: &str) -> usize {
    manager
        .attach("gui", id)
        .expect("session attachable")
        .replay
        .len()
}

#[tokio::test]
async fn freeze_stops_output_until_reattach() {
    let dir = tempfile::tempdir().expect("tempdir");
    let manager = SessionManager::new(dir.path().to_path_buf()).expect("manager");
    manager
        .create(
            "gui",
            "r1",
            "frozen-session",
            1,
            PersistencePolicy::FreezeWhileClosed,
            periodic_output(),
        )
        .expect("create");

    tokio::time::sleep(Duration::from_millis(2500)).await;
    let before = replay_len(&manager, "frozen-session");
    assert!(before > 0, "expected buffered output before freezing");

    manager.client_disconnected("gui");
    let summary = manager
        .list()
        .into_iter()
        .find(|session| session.id == "frozen-session")
        .expect("session listed");
    assert!(
        summary.frozen,
        "session must report frozen after last client left"
    );

    // The command blocks on stdin after the marker, so the buffer is provably
    // silent while frozen: any growth here would mean the tree kept running.
    tokio::time::sleep(Duration::from_millis(2500)).await;
    let during = replay_len(&manager, "frozen-session"); // resumes the tree
    assert_eq!(
        during, before,
        "a frozen tree must not append a single byte while no client is attached"
    );

    // Input only produces output if the resume actually revived the process.
    let _ = manager.input("frozen-session", "hello-from-resume\n");
    tokio::time::sleep(Duration::from_millis(2500)).await;
    let after = replay_len(&manager, "frozen-session");
    assert!(
        after > during,
        "input after reattach must reach the resumed process"
    );

    // Regression: the manifest must be rewritten with frozen=false right after
    // a successful resume. A stale frozen=true + pid + start_time on disk would
    // make the next boot sweep kill this healthy shell after a daemon restart.
    // Only one session exists in this temp state dir, so locate its manifest by
    // directory scan instead of reproducing the crate-private name hash.
    let sessions_dir = dir.path().join("sessions");
    let manifest_path = std::fs::read_dir(&sessions_dir)
        .expect("sessions dir exists")
        .filter_map(Result::ok)
        .find(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
        .map(|entry| entry.path())
        .expect("exactly one frozen manifest");
    let raw = std::fs::read_to_string(&manifest_path).expect("manifest readable");
    let parsed: serde_json::Value = serde_json::from_str(&raw).expect("valid manifest json");
    assert_eq!(parsed["frozen"], serde_json::Value::Bool(false));
    assert!(parsed["pid"].is_null());

    let _ = manager.disconnect("frozen-session");
}

#[tokio::test]
async fn freeze_skips_sessions_whose_shell_already_exited() {
    // Contract for the lifecycle guard in freeze(): a session whose shell
    // already exited must never be frozen — its pid slot may belong to another
    // process by the time the last client disconnects. (A recycled pid cannot
    // be produced deterministically here; this pins the observable behavior.)
    let dir = tempfile::tempdir().expect("tempdir");
    let manager = SessionManager::new(dir.path().to_path_buf()).expect("manager");
    let mut launch = periodic_output();
    #[cfg(windows)]
    {
        launch.args = vec!["/c".into(), "echo bye".into()];
    }
    #[cfg(not(windows))]
    {
        launch.args = vec!["-c".into(), "echo bye".into()];
    }
    manager
        .create(
            "gui",
            "r1",
            "exited-session",
            1,
            PersistencePolicy::FreezeWhileClosed,
            launch,
        )
        .expect("create");

    let mut closed = false;
    for _ in 0..50 {
        if manager.list().into_iter().any(|session| {
            session.id == "exited-session"
                && session.lifecycle == session_protocol::SessionLifecycle::Closed
        }) {
            closed = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(closed, "shell should exit on its own");

    manager.client_disconnected("gui");
    let summary = manager
        .list()
        .into_iter()
        .find(|session| session.id == "exited-session")
        .expect("session still listed after exit");
    assert!(
        !summary.frozen,
        "an exited shell must never be reported frozen"
    );
}

#[tokio::test]
async fn frozen_manifest_survives_daemon_restart_as_interrupted() {
    let dir = tempfile::tempdir().expect("tempdir");
    let manager = SessionManager::new(dir.path().to_path_buf()).expect("manager");
    manager
        .create(
            "gui",
            "r1",
            "frozen-restart",
            1,
            PersistencePolicy::FreezeWhileClosed,
            periodic_output(),
        )
        .expect("create");
    tokio::time::sleep(Duration::from_millis(400)).await;
    manager.client_disconnected("gui");

    let pid = manager
        .list()
        .into_iter()
        .find(|session| session.id == "frozen-restart")
        .expect("listed")
        .pid;

    drop(manager);
    let restarted = SessionManager::new(dir.path().to_path_buf()).expect("restarted manager");
    let record = restarted
        .list()
        .into_iter()
        .find(|session| session.id == "frozen-restart")
        .expect("frozen manifest survives restart");
    assert_eq!(
        record.lifecycle,
        session_protocol::SessionLifecycle::Interrupted
    );
    assert_eq!(record.policy, PersistencePolicy::FreezeWhileClosed);

    // Cleanup: on Windows the job object killed the suspended tree when the
    // first manager dropped. On Unix a stopped orphan would linger forever, so
    // explicitly resume and kill it.
    #[cfg(unix)]
    if let Some(pid) = pid {
        // SAFETY: test cleanup signalling our own child process.
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGCONT);
            libc::kill(pid as libc::pid_t, libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    let _ = pid;

    let _ = restarted.disconnect("frozen-restart");
}
