use std::path::{Path, PathBuf};
use std::sync::Arc;

use session_protocol::{ClientRequest, ServerMessage, PROTOCOL_VERSION};
#[cfg(test)]
use tokio::sync::watch;
use tokio::sync::{broadcast, Notify};

use crate::activity;
use crate::manager::SessionManager;
use crate::transport::{read_frame, write_frame, AsyncStream};

pub async fn run(state_dir: PathBuf) -> Result<(), String> {
    let manager = SessionManager::new(state_dir.clone())?;
    let _activity = activity::spawn(manager.clone());
    let _scrollback = crate::scrollback::spawn(manager.clone());
    let shutdown = Arc::new(Notify::new());
    run_platform_server(manager, &state_dir, shutdown).await
}

async fn handle_connection<S>(manager: SessionManager, stream: S, shutdown: Arc<Notify>)
where
    S: AsyncStream + 'static,
{
    handle_connection_inner(manager, stream, ShutdownSignal::Notify(shutdown)).await;
}

#[cfg(test)]
async fn handle_connection_with_shutdown<S>(
    manager: SessionManager,
    stream: S,
    shutdown: watch::Sender<bool>,
) where
    S: AsyncStream + 'static,
{
    handle_connection_inner(manager, stream, ShutdownSignal::Watch(shutdown)).await;
}

enum ShutdownSignal {
    Notify(Arc<Notify>),
    #[cfg(test)]
    Watch(watch::Sender<bool>),
}

impl ShutdownSignal {
    fn signal(&self) {
        match self {
            Self::Notify(shutdown) => shutdown.notify_one(),
            #[cfg(test)]
            Self::Watch(shutdown) => {
                let _ = shutdown.send(true);
            }
        }
    }
}

async fn handle_connection_inner<S>(
    manager: SessionManager,
    mut stream: S,
    shutdown: ShutdownSignal,
) where
    S: AsyncStream + 'static,
{
    let request = match read_frame::<ClientRequest>(&mut stream).await {
        Ok(request) => request,
        Err(_) => return,
    };
    match request {
        ClientRequest::Hello { protocol_version } => {
            let message = if protocol_version == PROTOCOL_VERSION {
                ServerMessage::Hello {
                    protocol_version: PROTOCOL_VERSION,
                }
            } else {
                ServerMessage::Error {
                    message: format!(
                        "Session daemon protocol mismatch: daemon={}, client={protocol_version}",
                        PROTOCOL_VERSION
                    ),
                }
            };
            let _ = write_frame(&mut stream, &message).await;
        }
        ClientRequest::ClientLease { client_id } => {
            if write_frame(&mut stream, &ServerMessage::Ok).await.is_err() {
                return;
            }
            while read_frame::<ClientRequest>(&mut stream).await.is_ok() {}
            if manager.client_disconnected(&client_id) && manager.is_idle() {
                shutdown.signal();
            }
        }
        ClientRequest::Create {
            client_id,
            request_id,
            session_id,
            generation,
            policy,
            launch,
        } => {
            let response = match manager.create(
                &client_id,
                &request_id,
                &session_id,
                generation,
                policy,
                launch,
            ) {
                Ok(session) => ServerMessage::Created { session },
                Err(message) => ServerMessage::Error { message },
            };
            let _ = write_frame(&mut stream, &response).await;
        }
        ClientRequest::Attach {
            client_id,
            session_id,
        } => match manager.attach(&client_id, &session_id) {
            Ok(mut attached) => {
                if write_frame(
                    &mut stream,
                    &ServerMessage::Attached {
                        snapshot: attached.snapshot,
                        replay: attached.replay,
                    },
                )
                .await
                .is_err()
                {
                    return;
                }
                loop {
                    match attached.receiver.recv().await {
                        Ok(message) => {
                            if write_frame(&mut stream, &message).await.is_err() {
                                return;
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => {
                            let _ = write_frame(
                                &mut stream,
                                &ServerMessage::Error {
                                    message: "Session stream fell behind; reattach to replay buffered output."
                                        .to_string(),
                                },
                            )
                            .await;
                            return;
                        }
                        Err(broadcast::error::RecvError::Closed) => return,
                    }
                }
            }
            Err(message) => {
                let _ = write_frame(&mut stream, &ServerMessage::Error { message }).await;
            }
        },
        ClientRequest::Input { session_id, data } => {
            write_result(&mut stream, manager.input(&session_id, &data)).await;
        }
        ClientRequest::Resize {
            session_id,
            cols,
            rows,
        } => {
            write_result(&mut stream, manager.resize(&session_id, cols, rows)).await;
        }
        ClientRequest::Disconnect { session_id } => {
            write_result(&mut stream, manager.disconnect(&session_id)).await;
        }
        ClientRequest::List => {
            let _ = write_frame(
                &mut stream,
                &ServerMessage::Sessions {
                    sessions: manager.list(),
                },
            )
            .await;
        }
        ClientRequest::SetPolicy {
            client_id,
            session_id,
            policy,
        } => {
            write_result(
                &mut stream,
                manager.set_policy(&client_id, &session_id, policy),
            )
            .await;
        }
    }
}

async fn write_result(stream: &mut dyn AsyncStream, result: Result<(), String>) {
    let message = match result {
        Ok(()) => ServerMessage::Ok,
        Err(message) => ServerMessage::Error { message },
    };
    let _ = write_frame(stream, &message).await;
}

// `run_platform_server` is the daemon's accept loop. Both variants bind a
// listening socket/pipe and accept clients until the GUI lease disconnects
// after all live and recoverable sessions are gone. Setup lines are exercised
// indirectly through `tests/client_daemon.rs`; the accept loop is daemon-only
// and excluded from coverage.
#[cfg_attr(coverage, coverage(off))]
#[cfg(unix)]
async fn run_platform_server(
    manager: SessionManager,
    state_dir: &Path,
    shutdown: Arc<Notify>,
) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let path = crate::transport::endpoint_path(state_dir);
    if path.exists() {
        if tokio::net::UnixStream::connect(&path).await.is_ok() {
            return Err("OmniTerm session daemon is already running.".to_string());
        }
        std::fs::remove_file(&path)
            .map_err(|error| format!("Could not remove stale daemon socket: {error}"))?;
    }
    let listener = tokio::net::UnixListener::bind(&path)
        .map_err(|error| format!("Could not bind OmniTerm session daemon socket: {error}"))?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("Could not secure OmniTerm session daemon socket: {error}"))?;
    loop {
        let accepted = tokio::select! {
            _ = shutdown.notified() => break,
            result = listener.accept() => result
                .map_err(|error| format!("Could not accept daemon client: {error}"))?,
        };
        let (stream, _) = accepted;
        tokio::spawn(handle_connection(
            manager.clone(),
            stream,
            Arc::clone(&shutdown),
        ));
    }
    let _ = std::fs::remove_file(&path);
    Ok(())
}

#[cfg_attr(coverage, coverage(off))]
#[cfg(windows)]
async fn run_platform_server(
    manager: SessionManager,
    state_dir: &Path,
    shutdown: Arc<Notify>,
) -> Result<(), String> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let name = crate::transport::endpoint_name(state_dir);
    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&name)
        .map_err(|error| format!("Could not create OmniTerm session daemon pipe: {error}"))?;
    loop {
        tokio::select! {
            _ = shutdown.notified() => break,
            result = server.connect() => {
                result.map_err(|error| format!("Could not accept daemon pipe client: {error}"))?;
            }
        }
        let connected = server;
        server = ServerOptions::new()
            .create(&name)
            .map_err(|error| format!("Could not create next daemon pipe instance: {error}"))?;
        tokio::spawn(handle_connection(
            manager.clone(),
            connected,
            Arc::clone(&shutdown),
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "server_tests.rs"]
mod tests;
