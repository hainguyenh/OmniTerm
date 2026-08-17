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
        self.expect_ok(ClientRequest::Disconnect { session_id }).await
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
