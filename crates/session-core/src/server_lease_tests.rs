//! When a client lease ends the daemon shuts down only if nothing is left to keep alive, and a
//! client that cannot be written to is dropped without further work.

use std::time::Duration;

use session_protocol::{ClientRequest, LaunchSpec, PersistencePolicy, ServerMessage};
use tokio::io::duplex;
use tokio::sync::watch;

use super::*;
use crate::io_failure_tests::FailingStream;
use crate::transport::{read_frame, write_frame};

fn idle_shell() -> LaunchSpec {
    #[cfg(windows)]
    let exe = "cmd.exe".to_string();
    #[cfg(not(windows))]
    let exe = "/bin/sh".to_string();
    LaunchSpec {
        exe,
        args: Vec::new(),
        cwd: None,
        env: Vec::new(),
        label: "lease-test".into(),
        launched_with_command: false,
        ssh: false,
    }
}

fn lease(client_id: &str) -> ClientRequest {
    ClientRequest::ClientLease {
        client_id: client_id.into(),
    }
}

/// Runs a lease for `client_id` until the client hangs up; reports whether shutdown fired.
async fn lease_ends_with_shutdown(manager: &SessionManager, client_id: &str) -> bool {
    let (mut client, server) = duplex(8 * 1024);
    let (shutdown, shutdown_rx) = watch::channel(false);
    write_frame(&mut client, &lease(client_id)).await.unwrap();
    let handle = tokio::spawn(handle_connection_with_shutdown(
        manager.clone(),
        server,
        shutdown,
    ));
    let granted = read_frame::<ServerMessage>(&mut client).await.unwrap();
    assert_eq!(granted, ServerMessage::Ok);
    drop(client);
    tokio::time::timeout(Duration::from_secs(2), handle)
        .await
        .expect("the lease must end once the client hangs up")
        .expect("the lease task must not panic");
    let fired = *shutdown_rx.borrow();
    fired
}

#[tokio::test]
async fn a_lease_end_keeps_the_daemon_for_another_clients_session() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "other",
            "r",
            "s",
            1,
            PersistencePolicy::KeepRunning,
            idle_shell(),
        )
        .unwrap();
    assert!(!lease_ends_with_shutdown(&manager, "gui").await);
    assert_eq!(manager.list().len(), 1);
    manager.disconnect("s").unwrap();
}

#[tokio::test]
async fn a_lease_end_keeps_the_daemon_while_interrupted_sessions_wait() {
    let dir = tempfile::tempdir().unwrap();
    let record = crate::manifest::SessionManifest::live(
        "waiting".into(),
        1,
        PersistencePolicy::KeepRunning,
        "waiting".into(),
        false,
        false,
        false,
    );
    crate::manifest::write(dir.path(), &record).unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    assert!(!lease_ends_with_shutdown(&manager, "gui").await);
    assert_eq!(manager.list()[0].id, "waiting");
}

#[tokio::test]
async fn a_lease_that_cannot_be_granted_ends_without_shutdown() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let (shutdown, shutdown_rx) = watch::channel(false);
    let stream = FailingStream::reading(&lease("gui")).await;
    tokio::time::timeout(
        Duration::from_secs(2),
        handle_connection_with_shutdown(manager, stream, shutdown),
    )
    .await
    .expect("an unwritable lease must end at once");
    assert!(!*shutdown_rx.borrow());
}

#[tokio::test]
async fn an_attach_that_cannot_be_answered_does_not_start_forwarding() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "gui",
            "r",
            "s",
            1,
            PersistencePolicy::KeepRunning,
            idle_shell(),
        )
        .unwrap();
    let request = ClientRequest::Attach {
        client_id: "gui".into(),
        session_id: "s".into(),
        binary_data: true,
    };
    let stream = FailingStream::reading(&request).await;
    // Forwarding would run until the session ends; returning promptly proves it was skipped.
    tokio::time::timeout(
        Duration::from_secs(2),
        handle_connection(manager.clone(), stream, Arc::new(Notify::new())),
    )
    .await
    .expect("an unwritable attach must end at once");
    manager.disconnect("s").unwrap();
}
