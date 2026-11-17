//! The client against a scripted daemon: error replies and replies of the wrong kind must come
//! back as errors, never as a hang or a panic.

use std::sync::Arc;

use session_protocol::{SessionLifecycle, PROTOCOL_VERSION};

use super::*;
use crate::transport::AsyncStream;

type Reply = dyn Fn(&ClientRequest) -> Option<ServerMessage> + Send + Sync;

/// Answers every request with `reply`; `None` closes the connection without an answer. Hello is
/// answered with a matching version unless `reply` handles it. A granted lease is dropped right
/// away, as when the daemon exits under a client.
async fn serve(mut stream: impl AsyncStream, reply: Arc<Reply>) {
    while let Ok(request) = read_frame::<ClientRequest>(&mut stream).await {
        let answer = match (&request, reply(&request)) {
            (_, Some(answer)) => answer,
            (ClientRequest::Hello { .. }, None) => ServerMessage::Hello {
                protocol_version: PROTOCOL_VERSION,
            },
            (_, None) => return,
        };
        if write_frame(&mut stream, &answer).await.is_err() {
            return;
        }
        if matches!(request, ClientRequest::ClientLease { .. }) {
            return;
        }
    }
}

#[cfg(unix)]
fn fake_daemon(state_dir: &Path, reply: Arc<Reply>) {
    let listener = tokio::net::UnixListener::bind(crate::transport::endpoint_path(state_dir))
        .expect("fake daemon socket must bind");
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(serve(stream, Arc::clone(&reply)));
        }
    });
}

#[cfg(windows)]
fn fake_daemon(state_dir: &Path, reply: Arc<Reply>) {
    use tokio::net::windows::named_pipe::ServerOptions;
    let name = crate::transport::endpoint_name(state_dir);
    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&name)
        .expect("fake daemon pipe must be created");
    tokio::spawn(async move {
        while server.connect().await.is_ok() {
            let Ok(next) = ServerOptions::new().create(&name) else {
                return;
            };
            let connected = std::mem::replace(&mut server, next);
            tokio::spawn(serve(connected, Arc::clone(&reply)));
        }
    });
}

fn client_for(
    reply: impl Fn(&ClientRequest) -> Option<ServerMessage> + Send + Sync + 'static,
) -> (tempfile::TempDir, SessionDaemonClient) {
    let dir = tempfile::tempdir().expect("temp dir");
    fake_daemon(dir.path(), Arc::new(reply));
    let client = SessionDaemonClient::new(
        dir.path().to_path_buf(),
        dir.path().join("no-such-daemon-binary"),
        "gui".into(),
    );
    (dir, client)
}

fn launch() -> LaunchSpec {
    LaunchSpec {
        exe: "shell".into(),
        args: Vec::new(),
        cwd: None,
        env: Vec::new(),
        label: "fake".into(),
        launched_with_command: false,
        ssh: false,
    }
}

fn denied() -> ServerMessage {
    ServerMessage::Error {
        message: "denied".into(),
    }
}

fn error_of<T>(result: Result<T, String>) -> String {
    match result {
        Ok(_) => panic!("expected an error"),
        Err(error) => error,
    }
}

async fn every_call(client: &SessionDaemonClient) -> Vec<String> {
    let recover = PersistencePolicy::RecoverAfterReboot;
    vec![
        error_of(client.create("s".into(), 1, recover, launch()).await),
        error_of(client.attach("s".into()).await),
        error_of(client.list().await),
        error_of(client.input("s".into(), "x".into()).await),
        error_of(client.resize("s".into(), 80, 24).await),
        error_of(client.disconnect("s".into()).await),
        error_of(client.set_policy("s".into(), recover).await),
        error_of(client.hold_lease().await),
    ]
}

#[tokio::test]
async fn daemon_errors_are_returned_from_every_call() {
    let (_dir, client) = client_for(|request| match request {
        ClientRequest::Hello { .. } => None,
        _ => Some(denied()),
    });
    assert_eq!(client.client_id(), "gui");
    assert!(every_call(&client)
        .await
        .iter()
        .all(|error| error == "denied"));
}

#[tokio::test]
async fn replies_of_the_wrong_kind_are_reported_per_call() {
    let (_dir, client) = client_for(|request| match request {
        ClientRequest::Hello { .. } => None,
        ClientRequest::Input { .. }
        | ClientRequest::Resize { .. }
        | ClientRequest::Disconnect { .. }
        | ClientRequest::SetPolicy { .. }
        | ClientRequest::ClientLease { .. } => Some(ServerMessage::Sessions {
            sessions: Vec::new(),
        }),
        _ => Some(ServerMessage::Ok),
    });
    let errors = every_call(&client).await;
    let prefixes = [
        "Unexpected daemon create response",
        "Unexpected daemon attach response",
        "Unexpected daemon list response",
        "Unexpected daemon response",
        "Unexpected daemon response",
        "Unexpected daemon response",
        "Unexpected daemon response",
        "Unexpected daemon lease response",
    ];
    for (error, prefix) in errors.iter().zip(prefixes) {
        assert!(
            error.starts_with(prefix),
            "{error} should start with {prefix}"
        );
    }
}

#[tokio::test]
async fn a_lease_ends_with_an_error_when_the_daemon_goes_away() {
    let (_dir, client) = client_for(|request| match request {
        ClientRequest::ClientLease { .. } => Some(ServerMessage::Ok),
        ClientRequest::List => Some(ServerMessage::Sessions {
            sessions: vec![SessionSummary {
                id: "s".into(),
                generation: 1,
                policy: PersistencePolicy::KeepRunning,
                lifecycle: SessionLifecycle::Live,
                pid: None,
                label: "fake".into(),
                busy: false,
                launched_with_command: false,
                ssh: false,
                frozen: false,
            }],
        }),
        _ => None,
    });
    assert_eq!(client.list().await.unwrap()[0].id, "s");
    let lease = error_of(client.hold_lease().await);
    assert!(
        lease.starts_with("Could not read daemon frame length"),
        "{lease}"
    );
    // A request the fake does not answer closes the stream, which ends a call with an error.
    let closed = error_of(client.input("s".into(), "x".into()).await);
    assert!(
        closed.starts_with("Could not read daemon frame length"),
        "{closed}"
    );
}

#[tokio::test]
async fn a_protocol_mismatch_is_returned_without_starting_a_daemon() {
    let (_dir, client) = client_for(|request| match request {
        ClientRequest::Hello { .. } => Some(ServerMessage::Error {
            message: "protocol mismatch: daemon speaks 0".into(),
        }),
        _ => None,
    });
    let error = error_of(client.ensure_running().await);
    assert!(error.starts_with("protocol mismatch"), "{error}");
}

#[tokio::test]
async fn an_unusable_daemon_is_restarted_from_the_executable() {
    let (_dir, client) = client_for(|request| match request {
        ClientRequest::Hello { .. } => Some(ServerMessage::Hello {
            protocol_version: PROTOCOL_VERSION + 1,
        }),
        _ => None,
    });
    // The wrong hello is treated as no daemon, so the client tries to launch its own, which
    // fails here because the executable does not exist.
    let error = error_of(client.list().await);
    assert!(
        error.starts_with("Could not start OmniTerm session daemon"),
        "{error}"
    );
}
