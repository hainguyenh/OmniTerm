use std::path::{Path, PathBuf};

use session_protocol::{ClientRequest, ServerMessage, PROTOCOL_VERSION};
use tokio::sync::broadcast;

use crate::activity;
use crate::manager::SessionManager;
use crate::transport::{read_frame, write_frame, AsyncStream};

pub async fn run(state_dir: PathBuf) -> Result<(), String> {
    let manager = SessionManager::new(state_dir.clone())?;
    let _activity = activity::spawn(manager.clone());
    let _scrollback = crate::scrollback::spawn(manager.clone());
    run_platform_server(manager, &state_dir).await
}

async fn handle_connection<S>(manager: SessionManager, mut stream: S)
where
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
            manager.client_disconnected(&client_id);
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

#[cfg(unix)]
async fn run_platform_server(manager: SessionManager, state_dir: &Path) -> Result<(), String> {
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
        let (stream, _) = listener
            .accept()
            .await
            .map_err(|error| format!("Could not accept daemon client: {error}"))?;
        tokio::spawn(handle_connection(manager.clone(), stream));
    }
}

#[cfg(windows)]
async fn run_platform_server(manager: SessionManager, state_dir: &Path) -> Result<(), String> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let name = crate::transport::endpoint_name(state_dir);
    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&name)
        .map_err(|error| format!("Could not create OmniTerm session daemon pipe: {error}"))?;
    loop {
        server
            .connect()
            .await
            .map_err(|error| format!("Could not accept daemon pipe client: {error}"))?;
        let connected = server;
        server = ServerOptions::new()
            .create(&name)
            .map_err(|error| format!("Could not create next daemon pipe instance: {error}"))?;
        tokio::spawn(handle_connection(manager.clone(), connected));
    }
}
