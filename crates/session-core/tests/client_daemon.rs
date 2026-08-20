use std::path::PathBuf;
use std::time::Duration;

use session_core::{run_daemon, SessionDaemonClient};
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

fn bad_cwd_launch() -> LaunchSpec {
    let mut launch = shell_launch("echo x");
    launch.cwd = Some("/nonexistent/omniterm-cwd-test".into());
    launch
}

fn shell_launch_with_cwd(command: &str, cwd: PathBuf) -> LaunchSpec {
    let mut launch = shell_launch(command);
    launch.cwd = Some(cwd.to_string_lossy().to_string());
    launch
}

#[tokio::test]
async fn client_full_lifecycle_against_a_running_daemon() {
    let dir = tempfile::tempdir().unwrap();
    let state_dir = dir.path().to_path_buf();

    // The daemon runs on its own multi-thread tokio runtime in a background
    // OS thread. `run_daemon` never returns, so we deliberately leak the
    // join handle; the OS reaps the thread when the test process exits.
    let _daemon_thread = std::thread::spawn({
        let state_dir = state_dir.clone();
        move || run_daemon(state_dir)
    });

    // Placeholder executable: `ensure_running` only falls back to
    // `spawn_daemon` when `hello_once` fails, and we poll-retry until the
    // pipe is listening so the fallback is never exercised.
    let client = SessionDaemonClient::new(
        state_dir.clone(),
        PathBuf::from("/nonexistent/omniterm-sessiond"),
        "test-client".into(),
    );

    // Wait for the named pipe / Unix domain socket to be listening.
    let mut ready = false;
    for _ in 0..120 {
        if client.ensure_running().await.is_ok() {
            ready = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(ready, "session daemon did not become ready in 6 s");

    // An empty daemon lists no sessions.
    assert!(client.list().await.unwrap().is_empty());

    // Create a real interactive PTY that stays alive via `cmd /k` or
    // `exec /bin/sh` so resize / input / attach have something to talk to.
    let session = client
        .create(
            "s1".into(),
            1,
            PersistencePolicy::KeepRunning,
            shell_launch("echo marker"),
        )
        .await
        .expect("create failed");
    assert_eq!(session.id, "s1");
    assert_eq!(session.lifecycle, SessionLifecycle::Live);

    // create() again for the still-live session under a fresh request id
    // resolves to the existing live session instead of spawning a second
    // process (manager.rs create existing-live path).
    let duplicate = client
        .create(
            "s1".into(),
            1,
            PersistencePolicy::KeepRunning,
            shell_launch("echo again"),
        )
        .await
        .expect("duplicate create for a live session must succeed");
    assert_eq!(duplicate.id, "s1");

    // create() with a resolvable working directory exercises manager.rs's
    // successful cwd canonicalize + `cmd.cwd()` path. Disconnect the extra
    // session so the trailing list-empty assertion still holds.
    let with_cwd = client
        .create(
            "with-cwd".into(),
            1,
            PersistencePolicy::KeepRunning,
            shell_launch_with_cwd("echo cwd", state_dir.clone()),
        )
        .await
        .expect("create with a valid cwd must succeed");
    assert_eq!(with_cwd.id, "with-cwd");
    client
        .disconnect("with-cwd".into())
        .await
        .expect("disconnect cwd session failed");

    // list() reflects the freshly created session.
    let sessions = client.list().await.unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "s1");

    // Resize, input, and set_policy all use the `RequestRaw` -> `expect_ok`
    // path on the client and the matching `write_result` arm on the server.
    client
        .resize("s1".into(), 100, 30)
        .await
        .expect("resize failed");
    client
        .input("s1".into(), "echo hi\r".into())
        .await
        .expect("input failed");
    client
        .set_policy("s1".into(), PersistencePolicy::RecoverAfterReboot)
        .await
        .expect("set_policy failed");

    // set_policy() flipped back to KeepRunning exercises the live-session
    // arm's `policy != RecoverAfterReboot` branch (scrollback removal).
    client
        .set_policy("s1".into(), PersistencePolicy::KeepRunning)
        .await
        .expect("set_policy to KeepRunning failed");

    // attach() returns a SessionSubscription attached to the session's
    // broadcast stream. Dropping the subscription closes the client-side
    // pipe; the server's next write fails and the attach loop exits.
    let mut subscription = client.attach("s1".into()).await.expect("attach failed");
    assert_eq!(subscription.snapshot.status, "ready");
    assert_eq!(subscription.snapshot.generation, 1);
    let _ = tokio::time::timeout(Duration::from_millis(500), subscription.next()).await;
    drop(subscription);

    // hold_lease() blocks forever inside its read loop. Exercising its
    // `ClientLease` -> `Ok` -> `loop` path requires a bounded task that we
    // abort after it has had a chance to connect.
    let lease_client = client.clone();
    let lease_handle = tokio::spawn(async move {
        let _ = lease_client.hold_lease().await;
    });
    tokio::time::sleep(Duration::from_millis(200)).await;
    lease_handle.abort();

    // create() with an unresolvable working directory fails on the daemon,
    // exercising the server's Create error arm and the client's
    // `ServerMessage::Error` handling in `create`.
    assert!(client
        .create(
            "bad".into(),
            1,
            PersistencePolicy::KeepRunning,
            bad_cwd_launch(),
        )
        .await
        .is_err());

    // Operations against a session the daemon has never seen surface the
    // daemon's Error response through the client's `expect_ok` and `attach`
    // error arms instead of panicking.
    assert!(client.input("nope".into(), "x".into()).await.is_err());
    assert!(client.resize("nope".into(), 80, 24).await.is_err());
    assert!(client
        .set_policy("nope".into(), PersistencePolicy::KeepRunning)
        .await
        .is_err());
    assert!(client.disconnect("nope".into()).await.is_err());
    assert!(client.attach("nope".into()).await.is_err());

    // disconnect() kills the PTY and removes the live entry. The in-memory
    // `interrupted` map is only populated at daemon startup, so list()
    // returns empty after the disconnect.
    client
        .disconnect("s1".into())
        .await
        .expect("disconnect failed");
    assert!(client.list().await.unwrap().is_empty());
}

#[test]
fn client_id_returns_the_value_passed_to_new_without_a_daemon() {
    let dir = tempfile::tempdir().unwrap();
    let client = SessionDaemonClient::new(
        dir.path().to_path_buf(),
        PathBuf::from("/nonexistent/omniterm-sessiond"),
        "my-client".into(),
    );
    assert_eq!(client.client_id(), "my-client");
}
