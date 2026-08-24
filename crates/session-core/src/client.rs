use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use session_protocol::{
    AttachSnapshot, ClientRequest, LaunchSpec, PersistencePolicy, ServerMessage, SessionSummary,
    PROTOCOL_VERSION,
};

use crate::transport::{connect, read_frame, write_frame, BoxedStream};

pub struct SessionSubscription {
    pub snapshot: AttachSnapshot,
    pub replay: Vec<u8>,
    stream: BoxedStream,
}

impl SessionSubscription {
    pub async fn next(&mut self) -> Result<ServerMessage, String> {
        read_frame(&mut *self.stream).await
    }
}

#[derive(Clone)]
pub struct SessionDaemonClient {
    state_dir: PathBuf,
    executable: PathBuf,
    client_id: String,
}

impl SessionDaemonClient {
    pub fn new(state_dir: PathBuf, executable: PathBuf, client_id: String) -> Self {
        Self {
            state_dir,
            executable,
            client_id,
        }
    }

    pub fn client_id(&self) -> &str {
        &self.client_id
    }

    pub async fn ensure_running(&self) -> Result<(), String> {
        match self.hello_once().await {
            Ok(()) => return Ok(()),
            Err(error) if error.contains("protocol mismatch") => return Err(error),
            Err(_) => {}
        }
        spawn_daemon(&self.executable, &self.state_dir)?;
        self.wait_until_ready().await
    }

    // After `spawn_daemon` launches a fresh daemon process the named pipe /
    // Unix socket is not yet listening, so this polls `hello_once` until the
    // daemon starts accepting connections or the boot window elapses. The loop
    // only runs in a real production launch: tests either find the daemon
    // already listening (the first `hello_once` returns Ok) or point the
    // client at a non-existent executable so `spawn_daemon` fails before the
    // loop. Driving a real slow-booting subprocess is neither safe nor
    // deterministic in a unit test, so the retry loop is excluded.
    #[cfg_attr(coverage, coverage(off))]
    async fn wait_until_ready(&self) -> Result<(), String> {
        let mut last_error = "Session daemon did not become ready.".to_string();
        for _ in 0..40 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            match self.hello_once().await {
                Ok(()) => return Ok(()),
                Err(error) if error.contains("protocol mismatch") => return Err(error),
                Err(error) => last_error = error,
            }
        }
        Err(last_error)
    }

    async fn hello_once(&self) -> Result<(), String> {
        match self
            .request_raw(ClientRequest::Hello {
                protocol_version: PROTOCOL_VERSION,
            })
            .await?
        {
            ServerMessage::Hello { protocol_version } if protocol_version == PROTOCOL_VERSION => {
                Ok(())
            }
            ServerMessage::Error { message } => Err(message),
            other => Err(format!("Unexpected daemon hello response: {other:?}")),
        }
    }

    pub async fn hold_lease(&self) -> Result<(), String> {
        self.ensure_running().await?;
        let mut stream = connect(&self.state_dir).await?;
        write_frame(
            &mut *stream,
            &ClientRequest::ClientLease {
                client_id: self.client_id.clone(),
            },
        )
        .await?;
        match read_frame::<ServerMessage>(&mut *stream).await? {
            ServerMessage::Ok => {}
            ServerMessage::Error { message } => return Err(message),
            other => return Err(format!("Unexpected daemon lease response: {other:?}")),
        }
        loop {
            read_frame::<ServerMessage>(&mut *stream).await?;
        }
    }

    pub async fn create(
        &self,
        session_id: String,
        generation: u64,
        policy: PersistencePolicy,
        launch: LaunchSpec,
    ) -> Result<SessionSummary, String> {
        self.ensure_running().await?;
        let response = self
            .request_raw(ClientRequest::Create {
                client_id: self.client_id.clone(),
                request_id: uuid::Uuid::new_v4().to_string(),
                session_id,
                generation,
                policy,
                launch,
            })
            .await?;
        match response {
            ServerMessage::Created { session } => Ok(session),
            ServerMessage::Error { message } => Err(message),
            other => Err(format!("Unexpected daemon create response: {other:?}")),
        }
    }

    pub async fn attach(&self, session_id: String) -> Result<SessionSubscription, String> {
        self.ensure_running().await?;
        let mut stream = connect(&self.state_dir).await?;
        write_frame(
            &mut *stream,
            &ClientRequest::Attach {
                client_id: self.client_id.clone(),
                session_id,
            },
        )
        .await?;
        match read_frame::<ServerMessage>(&mut *stream).await? {
            ServerMessage::Attached { snapshot, replay } => Ok(SessionSubscription {
                snapshot,
                replay,
                stream,
            }),
            ServerMessage::Error { message } => Err(message),
            other => Err(format!("Unexpected daemon attach response: {other:?}")),
        }
    }

    pub async fn list(&self) -> Result<Vec<SessionSummary>, String> {
        self.ensure_running().await?;
        match self.request_raw(ClientRequest::List).await? {
            ServerMessage::Sessions { sessions } => Ok(sessions),
            ServerMessage::Error { message } => Err(message),
            other => Err(format!("Unexpected daemon list response: {other:?}")),
        }
    }

    pub async fn input(&self, session_id: String, data: String) -> Result<(), String> {
        self.ensure_running().await?;
        self.expect_ok(ClientRequest::Input { session_id, data })
            .await
    }

    pub async fn resize(&self, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
        self.ensure_running().await?;
        self.expect_ok(ClientRequest::Resize {
            session_id,
            cols,
            rows,
        })
        .await
    }

    pub async fn disconnect(&self, session_id: String) -> Result<(), String> {
        self.ensure_running().await?;
        self.expect_ok(ClientRequest::Disconnect { session_id })
            .await
    }

    pub async fn set_policy(
        &self,
        session_id: String,
        policy: PersistencePolicy,
    ) -> Result<(), String> {
        self.ensure_running().await?;
        self.expect_ok(ClientRequest::SetPolicy {
            client_id: self.client_id.clone(),
            session_id,
            policy,
        })
        .await
    }

    async fn expect_ok(&self, request: ClientRequest) -> Result<(), String> {
        match self.request_raw(request).await? {
            ServerMessage::Ok => Ok(()),
            ServerMessage::Error { message } => Err(message),
            other => Err(format!("Unexpected daemon response: {other:?}")),
        }
    }

    async fn request_raw(&self, request: ClientRequest) -> Result<ServerMessage, String> {
        let mut stream = connect(&self.state_dir).await?;
        write_frame(&mut *stream, &request).await?;
        read_frame(&mut *stream).await
    }
}

fn spawn_daemon(executable: &Path, state_dir: &Path) -> Result<(), String> {
    let mut command = Command::new(executable);
    command
        .arg("--sessiond")
        .arg("--state-dir")
        .arg(state_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not start OmniTerm session daemon: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    #[tokio::test]
    async fn subscription_next_decodes_a_forwarded_frame() {
        // Stand up a duplex stream that the "server" side writes a real
        // length-prefixed frame into, then verify `next()` decodes it without a
        // running daemon. Covers the streaming-read path that the integration
        // test can only exercise through a timed-out await.
        let (mut server, client) = tokio::io::duplex(1024);
        let frame = serde_json::to_vec(&ServerMessage::Ok).unwrap();
        let mut buf = (frame.len() as u32).to_be_bytes().to_vec();
        buf.extend_from_slice(&frame);
        server.write_all(&buf).await.unwrap();
        server.flush().await.unwrap();

        let mut subscription = SessionSubscription {
            snapshot: AttachSnapshot {
                status: "ready".into(),
                label: None,
                error: None,
                busy: false,
                generation: 1,
            },
            replay: Vec::new(),
            stream: Box::new(client),
        };
        assert!(matches!(subscription.next().await, Ok(ServerMessage::Ok)));
    }
}
