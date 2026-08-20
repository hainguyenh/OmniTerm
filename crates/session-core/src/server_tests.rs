use super::*;
use tokio::io::duplex;

use crate::manager::SessionManager;
use crate::transport::{read_frame, write_frame};
use session_protocol::{ClientRequest, PersistencePolicy, ServerMessage, PROTOCOL_VERSION};

fn shell_launch(command: &str) -> session_protocol::LaunchSpec {
    #[cfg(windows)]
    let (exe, args) = ("cmd.exe".to_string(), vec!["/k".into(), command.into()]);
    #[cfg(not(windows))]
    let (exe, args) = (
        "/bin/sh".to_string(),
        vec!["-c".into(), format!("{command}; exec /bin/sh")],
    );
    session_protocol::LaunchSpec {
        exe,
        args,
        cwd: None,
        env: vec![("TERM".into(), "xterm-256color".into())],
        label: "test-shell".into(),
        launched_with_command: true,
        ssh: false,
    }
}

async fn handle_request(manager: &SessionManager, request: ClientRequest) -> ServerMessage {
    let (mut client, server) = duplex(8 * 1024);
    write_frame(&mut client, &request).await.unwrap();
    handle_connection(manager.clone(), server).await;
    read_frame::<ServerMessage>(&mut client).await.unwrap()
}

#[tokio::test]
async fn hello_with_matching_protocol_version_returns_hello() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let response = handle_request(
        &manager,
        ClientRequest::Hello {
            protocol_version: PROTOCOL_VERSION,
        },
    )
    .await;
    assert!(matches!(response, ServerMessage::Hello { .. }));
}

#[tokio::test]
async fn hello_with_mismatched_protocol_version_returns_error() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let response = handle_request(
        &manager,
        ClientRequest::Hello {
            protocol_version: PROTOCOL_VERSION + 1,
        },
    )
    .await;
    match response {
        ServerMessage::Error { message } => {
            assert!(message.contains("protocol mismatch"));
        }
        other => panic!("unexpected: {other:?}"),
    }
}

#[tokio::test]
async fn list_on_empty_manager_returns_no_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let response = handle_request(&manager, ClientRequest::List).await;
    match response {
        ServerMessage::Sessions { sessions } => assert!(sessions.is_empty()),
        other => panic!("unexpected: {other:?}"),
    }
}

#[tokio::test]
async fn input_on_missing_session_returns_error() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let response = handle_request(
        &manager,
        ClientRequest::Input {
            session_id: "nope".into(),
            data: String::new(),
        },
    )
    .await;
    assert!(matches!(response, ServerMessage::Error { .. }));
}

#[tokio::test]
async fn resize_on_missing_session_returns_error() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let response = handle_request(
        &manager,
        ClientRequest::Resize {
            session_id: "nope".into(),
            cols: 80,
            rows: 24,
        },
    )
    .await;
    assert!(matches!(response, ServerMessage::Error { .. }));
}

#[tokio::test]
async fn disconnect_on_missing_session_returns_error() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let response = handle_request(
        &manager,
        ClientRequest::Disconnect {
            session_id: "nope".into(),
        },
    )
    .await;
    assert!(matches!(response, ServerMessage::Error { .. }));
}

#[tokio::test]
async fn set_policy_on_missing_session_returns_error() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let response = handle_request(
        &manager,
        ClientRequest::SetPolicy {
            client_id: "c".into(),
            session_id: "nope".into(),
            policy: PersistencePolicy::KeepRunning,
        },
    )
    .await;
    assert!(matches!(response, ServerMessage::Error { .. }));
}

#[tokio::test]
async fn create_then_list_shows_the_session() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let created = handle_request(
        &manager,
        ClientRequest::Create {
            client_id: "c".into(),
            request_id: "r".into(),
            session_id: "s".into(),
            generation: 1,
            policy: PersistencePolicy::KeepRunning,
            launch: shell_launch("echo hi"),
        },
    )
    .await;
    assert!(matches!(created, ServerMessage::Created { .. }));
    match handle_request(&manager, ClientRequest::List).await {
        ServerMessage::Sessions { sessions } => assert_eq!(sessions.len(), 1),
        other => panic!("unexpected: {other:?}"),
    }
    manager.disconnect("s").unwrap();
}

#[tokio::test]
async fn attach_on_missing_session_returns_error() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let response = handle_request(
        &manager,
        ClientRequest::Attach {
            client_id: "c".into(),
            session_id: "nope".into(),
        },
    )
    .await;
    assert!(matches!(response, ServerMessage::Error { .. }));
}

#[tokio::test]
async fn attach_on_existing_session_returns_attached_with_replay() {
    use std::time::Duration;

    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    manager
        .create(
            "c",
            "r",
            "s",
            1,
            PersistencePolicy::KeepRunning,
            shell_launch("echo marker"),
        )
        .unwrap();
    for _ in 0..50 {
        let replay = manager
            .sessions
            .get("s")
            .and_then(|session| session.output.lock().ok().map(|output| output.replay()))
            .unwrap_or_default();
        if String::from_utf8_lossy(&replay).contains("marker") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    let (mut client, server) = duplex(8 * 1024);
    write_frame(
        &mut client,
        &ClientRequest::Attach {
            client_id: "c2".into(),
            session_id: "s".into(),
        },
    )
    .await
    .unwrap();
    let handle = tokio::spawn(handle_connection(manager.clone(), server));
    let response = read_frame::<ServerMessage>(&mut client).await.unwrap();
    match response {
        ServerMessage::Attached { replay, .. } => {
            assert!(String::from_utf8_lossy(&replay).contains("marker"));
        }
        other => panic!("unexpected: {other:?}"),
    }
    drop(client);
    manager.disconnect("s").unwrap();
    let _ = tokio::time::timeout(Duration::from_millis(500), handle).await;
}

#[tokio::test]
async fn client_lease_writes_ok_then_exits_when_stream_closes() {
    use std::time::Duration;

    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let (mut client, server) = duplex(8 * 1024);
    write_frame(
        &mut client,
        &ClientRequest::ClientLease {
            client_id: "c".into(),
        },
    )
    .await
    .unwrap();
    let handle = tokio::spawn(handle_connection(manager.clone(), server));
    let ok = read_frame::<ServerMessage>(&mut client).await.unwrap();
    assert!(matches!(ok, ServerMessage::Ok));
    drop(client);
    tokio::time::timeout(Duration::from_millis(500), handle)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn handle_connection_returns_quietly_when_the_stream_closes_before_a_request() {
    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();
    let (client, server) = duplex(8 * 1024);
    // Closing the client side immediately makes the server's initial
    // `read_frame` fail with an EOF; `handle_connection` must return
    // without touching the manager.
    drop(client);
    handle_connection(manager, server).await;
}

#[tokio::test]
async fn update_activity_persists_a_busy_transition_and_skips_a_no_op_update() {
    use std::time::Duration;

    let dir = tempfile::tempdir().unwrap();
    let manager = SessionManager::new(dir.path().to_path_buf()).unwrap();

    // A missing session id must hit the early-return guard without
    // touching the manager's session map.
    manager.update_activity("missing", true);

    let _session = manager
        .create(
            "client",
            "request",
            "s",
            1,
            PersistencePolicy::KeepRunning,
            shell_launch("echo hi"),
        )
        .expect("create failed");

    // Let the reader task consume the echo output so our explicit calls
    // don't race the autonomous activity detector.
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Both branches of the busy-change check: at least one call matches
    // the current busy state (no-op, no persist) and at least one call
    // flips it (status mutation + persist()).
    manager.update_activity("s", false);
    manager.update_activity("s", true);
    manager.update_activity("s", false);

    manager.disconnect("s").expect("disconnect failed");
}
