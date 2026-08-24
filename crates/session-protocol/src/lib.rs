//! Tauri-free wire protocol between the OmniTerm GUI and its local session daemon.

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests;

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PersistencePolicy {
    CloseWithApp,
    KeepRunning,
    RecoverAfterReboot,
    FreezeWhileClosed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSpec {
    pub exe: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Vec<(String, String)>,
    pub label: String,
    pub launched_with_command: bool,
    pub ssh: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionLifecycle {
    Live,
    Interrupted,
    Closed,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub generation: u64,
    pub policy: PersistencePolicy,
    pub lifecycle: SessionLifecycle,
    pub pid: Option<u32>,
    pub label: String,
    pub busy: bool,
    pub launched_with_command: bool,
    pub ssh: bool,
    /// True while the session's process tree is suspended under FreezeWhileClosed.
    pub frozen: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachSnapshot {
    pub status: String,
    pub label: Option<String>,
    pub error: Option<String>,
    pub busy: bool,
    pub generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DaemonStatus {
    Ready { label: String },
    Error { message: String },
    Closed { code: u32 },
    Activity { busy: bool },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ClientRequest {
    Hello {
        protocol_version: u32,
    },
    ClientLease {
        client_id: String,
    },
    Create {
        client_id: String,
        request_id: String,
        session_id: String,
        generation: u64,
        policy: PersistencePolicy,
        launch: LaunchSpec,
    },
    Attach {
        client_id: String,
        session_id: String,
    },
    Input {
        session_id: String,
        data: String,
    },
    Resize {
        session_id: String,
        cols: u16,
        rows: u16,
    },
    Disconnect {
        session_id: String,
    },
    List,
    SetPolicy {
        client_id: String,
        session_id: String,
        policy: PersistencePolicy,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ServerMessage {
    Hello {
        protocol_version: u32,
    },
    Ok,
    Error {
        message: String,
    },
    Created {
        session: SessionSummary,
    },
    Sessions {
        sessions: Vec<SessionSummary>,
    },
    Attached {
        snapshot: AttachSnapshot,
        replay: Vec<u8>,
    },
    Data {
        data: Vec<u8>,
    },
    Status {
        status: DaemonStatus,
    },
}
