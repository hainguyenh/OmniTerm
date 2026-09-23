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
    shutdown_requested: Arc<AtomicBool>,
}
impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            client: OnceLock::new(),
            lease_started: AtomicBool::new(false),
            shutdown_requested: Arc::new(AtomicBool::new(false)),
        }
    }

    pub(crate) fn begin_shutdown(&self) {
        self.shutdown_requested.store(true, Ordering::Release);
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
        crate::pty_lease::ensure(&self.client, &self.lease_started, &self.shutdown_requested);
        Ok(())
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

    pub(crate) async fn refresh(&self) -> Result<Vec<SessionSummary>, String> {
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

/// Whether the shell's own inline prediction (PowerShell's PSReadLine) should run. Missing or
/// malformed settings default to on, matching `defaults()` — a corrupt or pre-upgrade settings
/// file must not silently disable completion.
pub(crate) fn command_completion_enabled(settings: &serde_json::Value) -> bool {
    settings
        .get("commandCompletion")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(true)
}

/// A `(name, value)` env pair that puts a POSIX shell in a UTF-8 locale, added only when the host
/// has no locale opinion of its own. `LC_ALL`, `LC_CTYPE`, and `LANG` are all checked because any
/// one of them can already fix a shell's locale; a `Some("")` (set but empty) counts as unset, the
/// same way glibc treats it. Windows has ConPTY's `chcp 65001` for the equivalent job instead.
pub(crate) fn utf8_locale_fallback(
    os: &str,
    lookup: impl Fn(&str) -> Option<OsString>,
) -> Option<(&'static str, &'static str)> {
    let has_locale = ["LC_ALL", "LC_CTYPE", "LANG"]
        .iter()
        .any(|name| lookup(name).is_some_and(|value| !value.is_empty()));
    if has_locale {
        return None;
    }
    match os {
        "macos" => Some(("LANG", "en_US.UTF-8")),
        "linux" => Some(("LANG", "C.UTF-8")),
        _ => None,
    }
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
    on_status: Channel<SessionStatus>
) -> Result<(), String> {
    state.configure(&app)?;
    let launch = resolve_local_launch(&app, &conn_id, shell).await?;
    let command_completion = command_completion_enabled(&crate::settings::read_settings(&app));
    let invocation = launch.invocation_with_completion(command_completion)?;
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
    if let Some((key, value)) = utf8_locale_fallback(std::env::consts::OS, |name| {
        std::env::var_os(name)
    }) {
        env.push((key.to_string(), value.to_string()));
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
    // Restart restoration is reconstruction, never process reattachment. Remove any stale daemon
    // session under this stable tab id, then launch a fresh close-with-app PTY.
    let _ = client.disconnect(id.clone()).await;
    let summary = client
        .create(id.clone(), 1, PersistencePolicy::CloseWithApp, spec)
        .await?;
    state.cache_summary(&summary);
    let mut subscription = client.attach(id.clone()).await?;
    crate::pty_status::send_initial_status(
        &on_status,
        &subscription.snapshot,
        subscription.replay.len(),
    );
    if !subscription.replay.is_empty() {
        on_data
            .send(Response::new(std::mem::take(&mut subscription.replay)))
            .map_err(|error| error.to_string())?;
    }
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
    crate::pty_status::send_initial_status(
        &on_status,
        &subscription.snapshot,
        subscription.replay.len(),
    );
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
                    if on_status
                        .send(crate::pty_status::to_tauri_status(status))
                        .is_err()
                    {
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
