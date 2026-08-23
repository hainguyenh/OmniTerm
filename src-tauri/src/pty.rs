//! Tauri bridge to the out-of-process terminal session daemon.

use crate::launcher;
#[cfg(test)]
#[path = "pty_tests.rs"]
mod tests;
use crate::pty_resolve::resolve_local_launch;
use dashmap::DashMap;
use session_core::{SessionDaemonClient, SessionSubscription};
use session_protocol::{
    DaemonStatus, LaunchSpec, PersistencePolicy, ServerMessage, SessionLifecycle, SessionSummary,
};
use std::ffi::OsString;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Manager, Runtime};
use uuid::Uuid;

pub use app_protocol::session_status::SessionStatus;

#[derive(Debug, Clone)]
pub struct PtySessionMeta {
    pub pid: Option<u32>,
    pub launched_with_command: bool,
    pub ssh: bool,
    pub busy: bool,
    pub generation: u64,
    pub policy: PersistencePolicy,
    pub lifecycle: SessionLifecycle,
    pub label: String,
}

pub struct PtyManager {
    pub sessions: Arc<DashMap<String, PtySessionMeta>>,
    client: OnceLock<SessionDaemonClient>,
    lease_started: AtomicBool,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            client: OnceLock::new(),
            lease_started: AtomicBool::new(false),
        }
    }

    pub fn configure<R: Runtime>(&self, app: &AppHandle<R>) -> Result<(), String> {
        if self.client.get().is_none() {
            let state_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("sessiond");
            let executable = std::env::current_exe()
                .map_err(|error| format!("Could not resolve OmniTerm executable: {error}"))?;
            let client =
                SessionDaemonClient::new(state_dir, executable, format!("gui-{}", Uuid::new_v4()));
            let _ = self.client.set(client);
        }
        self.ensure_lease();
        Ok(())
    }

    fn ensure_lease(&self) {
        if self.lease_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let Some(client) = self.client.get().cloned() else {
            self.lease_started.store(false, Ordering::Release);
            return;
        };
        tauri::async_runtime::spawn(async move {
            // Exponential backoff between lease attempts. A daemon that is up
            // re-accepts instantly (failures reset), but a dead or uninstallable
            // daemon must not be hammered with connect/spawn attempts at 4 Hz.
            const BASE_RETRY_MS: u64 = 250;
            const MAX_BACKOFF_SHIFT: u32 = 5; // 250ms * 2^5 = 8s ceiling
            let mut failures: u32 = 0;
            loop {
                match client.hold_lease().await {
                    Ok(()) => failures = 0,
                    Err(error) => {
                        failures = failures.saturating_add(1);
                        log::debug!("[sessiond] client lease ended: {error}");
                    }
                }
                let delay = BASE_RETRY_MS << failures.min(MAX_BACKOFF_SHIFT);
                tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
            }
        });
    }

    pub(crate) fn client(&self) -> Result<SessionDaemonClient, String> {
        self.client
            .get()
            .cloned()
            .ok_or_else(|| "Terminal session daemon is not initialized".to_string())
    }

    fn cache_summary(&self, summary: &SessionSummary) {
        if summary.lifecycle == SessionLifecycle::Interrupted {
            self.sessions.remove(&summary.id);
            return;
        }
        self.sessions.insert(
            summary.id.clone(),
            PtySessionMeta {
                pid: summary.pid,
                launched_with_command: summary.launched_with_command,
                ssh: summary.ssh,
                busy: summary.busy,
                generation: summary.generation,
                policy: summary.policy,
                lifecycle: summary.lifecycle,
                label: summary.label.clone(),
            },
        );
    }

    async fn refresh(&self) -> Result<Vec<SessionSummary>, String> {
        let sessions = self.client()?.list().await?;
        self.sessions.clear();
        for summary in &sessions {
            self.cache_summary(summary);
        }
        Ok(sessions)
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

fn path_with_helper<R: Runtime>(app: &AppHandle<R>) -> Option<OsString> {
    let bin_dir = launcher::launcher_bin_dir(app);
    let current = std::env::var_os("PATH")?;
    let mut parts = vec![bin_dir];
    parts.extend(std::env::split_paths(&current));
    std::env::join_paths(parts).ok()
}

pub(crate) fn colorfgbg_for_dark_mode(dark_mode: Option<bool>) -> Option<&'static str> {
    dark_mode.map(|dark| if dark { "15;0" } else { "0;15" })
}

// `clippy::too_many_arguments` allow: Tauri injects AppHandle, State, and the two Channels
// positionally; the renderer args cannot collapse into a struct without changing the IPC contract.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn start_local_session<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, PtyManager>,
    id: String,
    conn_id: String,
    shell: Option<String>,
    dark_mode: Option<bool>,
    on_data: Channel<Response>,
    on_status: Channel<SessionStatus>,
) -> Result<(), String> {
    state.configure(&app)?;
    let launch = resolve_local_launch(&app, &conn_id, shell).await?;
    let invocation = launch.invocation()?;
    let mut env = vec![
        ("TERM".to_string(), "xterm-256color".to_string()),
        ("COLORTERM".to_string(), "truecolor".to_string()),
    ];
    if let Some(path) = path_with_helper(&app) {
        env.push(("PATH".to_string(), path.to_string_lossy().into_owned()));
    }
    if let Some(value) = colorfgbg_for_dark_mode(dark_mode) {
        env.push(("COLORFGBG".to_string(), value.to_string()));
    }
    let launched_with_command = launch.command.is_some();
    let ssh = launch
        .command
        .as_deref()
        .is_some_and(|command| command.to_ascii_lowercase().contains("ssh.exe"));
    let spec = LaunchSpec {
        exe: invocation.exe,
        args: invocation.args,
        cwd: launch.cwd,
        env,
        label: launch.shell.label().to_string(),
        launched_with_command,
        ssh,
    };
    let client = state.client()?;
    let previous = client
        .list()
        .await
        .unwrap_or_default()
        .into_iter()
        .find(|session| session.id == id);
    let generation = previous
        .as_ref()
        .map(|session| session.generation.saturating_add(1))
        .unwrap_or(1);
    let policy = previous
        .as_ref()
        .map(|session| session.policy)
        .unwrap_or(PersistencePolicy::CloseWithApp);
    let summary = client.create(id.clone(), generation, policy, spec).await?;
    state.cache_summary(&summary);
    let mut subscription = client.attach(id.clone()).await?;
    if !subscription.replay.is_empty() {
        on_data
            .send(Response::new(std::mem::take(&mut subscription.replay)))
            .map_err(|error| error.to_string())?;
    }
    send_initial_status(&on_status, &subscription.snapshot);
    spawn_stream(id, subscription, on_data, on_status, state.inner());
    Ok(())
}

#[tauri::command]
pub async fn send_session_input(
    state: tauri::State<'_, PtyManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    state.client()?.input(id, data).await
}

#[tauri::command]
pub async fn resize_session(
    state: tauri::State<'_, PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.client()?.resize(id, cols, rows).await
}

#[tauri::command]
pub async fn disconnect_session(
    state: tauri::State<'_, PtyManager>,
    id: String,
) -> Result<(), String> {
    state.sessions.remove(&id);
    state.client()?.disconnect(id).await
}

#[tauri::command]
pub async fn list_local_sessions(
    state: tauri::State<'_, PtyManager>,
) -> Result<Vec<SessionSummary>, String> {
    state.refresh().await
}

#[tauri::command]
pub async fn set_session_persistence(
    state: tauri::State<'_, PtyManager>,
    id: String,
    policy: PersistencePolicy,
) -> Result<(), String> {
    state.client()?.set_policy(id.clone(), policy).await?;
    if let Some(mut session) = state.sessions.get_mut(&id) {
        session.policy = policy;
    }
    Ok(())
}

pub(crate) async fn attach_existing_session(
    manager: &PtyManager,
    id: String,
    on_data: Channel<Response>,
    on_status: Channel<SessionStatus>,
) -> Result<Option<session_protocol::AttachSnapshot>, String> {
    let client = manager.client()?;
    let mut subscription = match client.attach(id.clone()).await {
        Ok(subscription) => subscription,
        Err(error) if error.contains("Session not found") || error.contains("interrupted") => {
            return Ok(None);
        }
        Err(error) => return Err(error),
    };
    if !subscription.replay.is_empty() {
        on_data
            .send(Response::new(std::mem::take(&mut subscription.replay)))
            .map_err(|error| error.to_string())?;
    }
    let snapshot = subscription.snapshot.clone();
    spawn_stream(id, subscription, on_data, on_status, manager);
    Ok(Some(snapshot))
}

pub(crate) fn kill_session(manager: &PtyManager, id: &str) {
    manager.sessions.remove(id);
    let Ok(client) = manager.client() else {
        return;
    };
    let id = id.to_string();
    tauri::async_runtime::spawn(async move {
        let _ = client.disconnect(id).await;
    });
}

fn send_initial_status(
    on_status: &Channel<SessionStatus>,
    snapshot: &session_protocol::AttachSnapshot,
) {
    match snapshot.status.as_str() {
        "ready" => {
            let _ = on_status.send(SessionStatus::Ready {
                label: snapshot
                    .label
                    .clone()
                    .unwrap_or_else(|| "Terminal".to_string()),
            });
            let _ = on_status.send(SessionStatus::Activity {
                busy: snapshot.busy,
            });
        }
        "error" => {
            let _ = on_status.send(SessionStatus::Error {
                message: snapshot
                    .error
                    .clone()
                    .unwrap_or_else(|| "Terminal session failed".to_string()),
            });
        }
        "closed" => {
            let _ = on_status.send(SessionStatus::Closed { code: 0 });
        }
        _ => {}
    }
}

fn spawn_stream(
    id: String,
    mut subscription: SessionSubscription,
    on_data: Channel<Response>,
    on_status: Channel<SessionStatus>,
    manager: &PtyManager,
) {
    let sessions = manager.sessions.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let message = match subscription.next().await {
                Ok(message) => message,
                Err(error) => {
                    // A renderer going away is observed through a failed channel send below. Getting
                    // here means the daemon subscription itself vanished, so do not leave the pane
                    // falsely "connected" or cold-spawn a replacement behind the user's back.
                    if let Some(mut meta) = sessions.get_mut(&id) {
                        if meta.lifecycle == SessionLifecycle::Live {
                            meta.lifecycle = SessionLifecycle::Error;
                        }
                    }
                    let _ = on_status.send(SessionStatus::Error {
                        message: format!("Terminal session service disconnected: {error}"),
                    });
                    break;
                }
            };
            match message {
                ServerMessage::Data { data } => {
                    if on_data.send(Response::new(data)).is_err() {
                        break;
                    }
                }
                ServerMessage::Status { status } => {
                    if let Some(mut meta) = sessions.get_mut(&id) {
                        match &status {
                            DaemonStatus::Activity { busy } => meta.busy = *busy,
                            DaemonStatus::Closed { .. } => {
                                meta.busy = false;
                                meta.lifecycle = SessionLifecycle::Closed;
                            }
                            DaemonStatus::Error { .. } => meta.lifecycle = SessionLifecycle::Error,
                            DaemonStatus::Ready { label } => meta.label = label.clone(),
                        }
                    }
                    if on_status.send(to_tauri_status(status)).is_err() {
                        break;
                    }
                }
                ServerMessage::Error { message } => {
                    let _ = on_status.send(SessionStatus::Error { message });
                    break;
                }
                _ => {}
            }
        }
    });
}

fn to_tauri_status(status: DaemonStatus) -> SessionStatus {
    match status {
        DaemonStatus::Ready { label } => SessionStatus::Ready { label },
        DaemonStatus::Error { message } => SessionStatus::Error { message },
        DaemonStatus::Closed { code } => SessionStatus::Closed { code },
        DaemonStatus::Activity { busy } => SessionStatus::Activity { busy },
    }
}
