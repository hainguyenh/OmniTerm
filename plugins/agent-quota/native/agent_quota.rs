//! Agent Quota runtime: detects the AI agent in each local terminal and freezes or thaws it on the
//! renderer's request.
//!
//! Quota data, limits and the watchdog live in the plugin (Node sidecar + renderer). This module
//! only owns what needs the process table: which agent and profile a terminal runs, and the
//! processes it froze — so they are thawed on resume, on plugin shutdown and when the app exits,
//! and never left suspended behind a closed window.

use std::collections::HashMap;
use std::sync::Mutex;
use sysinfo::System;
use tauri::{AppHandle, Manager, Runtime};

#[path = "agent_detect.rs"]
mod agent_detect;
#[path = "agent_guard.rs"]
mod agent_guard;
#[path = "agent_snapshot.rs"]
mod agent_snapshot;
#[path = "process_suspend.rs"]
mod process_suspend;

use agent_detect::{ProcRow, ProcTarget};
use agent_guard::{NativeOps, ProcOps};
pub use agent_guard::{SessionAgent, SuspendReport};

/// Where process rows come from. Injectable, so the commands are tested without real processes.
trait ProcSource: Send + Sync {
    /// Rows for detection: names for every shell tree, plus only the command lines and profile
    /// environment that decide something (see `agent_snapshot`).
    fn detection_rows(&self, shells: &[u32]) -> Vec<ProcRow>;
    /// Rows for acting on one terminal: names plus script-host command lines, no environment.
    fn action_rows(&self, shell: u32) -> Vec<ProcRow>;
    fn start_times(&self, pids: &[u32]) -> HashMap<u32, u64>;
}

/// The live process table. Its `System` is reused so sysinfo keeps its buffers, and is only
/// locked inside blocking work.
#[derive(Default)]
struct LiveSource {
    system: Mutex<System>,
}

impl LiveSource {
    fn with_system<T: Default>(&self, work: impl FnOnce(&mut System) -> T) -> T {
        self.system
            .lock()
            .map(|mut system| work(&mut system))
            .unwrap_or_default()
    }
}

impl ProcSource for LiveSource {
    fn detection_rows(&self, shells: &[u32]) -> Vec<ProcRow> {
        self.with_system(|system| {
            let mut rows = agent_snapshot::tree_rows(system, shells);
            let hosts = agent_detect::script_host_pids(&rows);
            agent_snapshot::fill_command_lines(system, &mut rows, &hosts);
            let launchers: Vec<u32> = shells
                .iter()
                .flat_map(|&shell| agent_detect::launcher_host_pids(&rows, shell))
                .collect();
            agent_snapshot::fill_command_lines(system, &mut rows, &launchers);
            let unknown: Vec<u32> = shells
                .iter()
                .filter_map(|&shell| agent_detect::needs_profile_env(&rows, shell))
                .collect();
            agent_snapshot::fill_profile_env(system, &mut rows, &unknown);
            rows
        })
    }

    fn action_rows(&self, shell: u32) -> Vec<ProcRow> {
        self.with_system(|system| agent_snapshot::action_rows(system, shell))
    }

    fn start_times(&self, pids: &[u32]) -> HashMap<u32, u64> {
        self.with_system(|system| agent_snapshot::start_times(system, pids))
    }
}

pub struct AgentQuotaState {
    source: Box<dyn ProcSource>,
    ops: Box<dyn ProcOps>,
    /// Session id → the processes (and threads) this module froze for it.
    held: Mutex<HashMap<String, Vec<ProcTarget>>>,
}

impl Default for AgentQuotaState {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentQuotaState {
    pub fn new() -> Self {
        Self {
            source: Box::new(LiveSource::default()),
            ops: Box::new(NativeOps),
            held: Mutex::new(HashMap::new()),
        }
    }

    /// Thaw everything still held. Called when the app exits: a suspended agent must never outlive
    /// the window that could resume it.
    pub fn resume_all(&self) -> usize {
        let held: Vec<ProcTarget> = match self.held.lock() {
            Ok(mut held) => held.drain().flat_map(|(_, targets)| targets).collect(),
            Err(_) => return 0,
        };
        self.resume_targets(held)
    }

    fn resume_targets(&self, held: Vec<ProcTarget>) -> usize {
        let pids: Vec<u32> = held.iter().map(|target| target.pid).collect();
        let live = self.source.start_times(&pids);
        agent_guard::resume_held(self.ops.as_ref(), held, &live)
    }

    fn take_held(&self, session_id: &str) -> Vec<ProcTarget> {
        self.held
            .lock()
            .ok()
            .and_then(|mut held| held.remove(session_id))
            .unwrap_or_default()
    }

    fn get_held(&self, session_id: Option<&str>) -> Vec<ProcTarget> {
        let held = match self.held.lock() {
            Ok(h) => h,
            Err(_) => return Vec::new(),
        };
        if let Some(id) = session_id {
            held.get(id).cloned().unwrap_or_default()
        } else {
            held.values().flatten().cloned().collect()
        }
    }

    fn resume_pid(&self, session_id: &str, pid: u32) -> Result<bool, String> {
        let mut held_guard = self
            .held
            .lock()
            .map_err(|_| "Agent Quota hold lock is poisoned".to_string())?;
        let Some(targets) = held_guard.get_mut(session_id) else {
            return Ok(false);
        };
        let Some(pos) = targets.iter().position(|t| t.pid == pid) else {
            return Ok(false);
        };
        let target = targets.remove(pos);
        let _ = self.ops.resume(target.pid, &target.threads);
        Ok(true)
    }

    fn detect(&self, shells: &[(String, u32)]) -> Vec<SessionAgent> {
        let pids: Vec<u32> = shells.iter().map(|(_, pid)| *pid).collect();
        let rows = self.source.detection_rows(&pids);
        let home = agent_snapshot::home_dir();
        agent_guard::detect_sessions(&rows, shells, home.as_deref())
    }

    fn suspend(
        &self,
        session_id: &str,
        shell: u32,
        pid: u32,
        start_time: u64,
    ) -> Result<SuspendReport, String> {
        let rows = self.source.action_rows(shell);
        let mut held = self
            .held
            .lock()
            .map_err(|_| "Agent Quota hold lock is poisoned".to_string())?;
        let entry = held.entry(session_id.to_string()).or_default();
        let home = agent_snapshot::home_dir();
        agent_guard::suspend_session(self.ops.as_ref(), &rows, shell, pid, start_time, entry, home.as_deref())
    }

    fn terminate(
        &self,
        session_id: &str,
        shell: u32,
        pid: u32,
        start_time: u64,
    ) -> Result<usize, String> {
        let rows = self.source.action_rows(shell);
        let held = self.take_held(session_id);
        let home = agent_snapshot::home_dir();
        agent_guard::terminate_session(self.ops.as_ref(), &rows, shell, pid, start_time, held, home.as_deref())
    }
}

/// `(session id, shell pid)` for every local session. SSH panes run their agent on another machine.
fn local_shells<R: Runtime>(app: &AppHandle<R>) -> Vec<(String, u32)> {
    let Some(manager) = app.try_state::<crate::pty::PtyManager>() else {
        return Vec::new();
    };
    manager
        .sessions
        .iter()
        .filter(|entry| !entry.ssh)
        .filter_map(|entry| entry.pid.map(|pid| (entry.key().clone(), pid)))
        .collect()
}

fn session_shell<R: Runtime>(app: &AppHandle<R>, session_id: &str) -> Result<u32, String> {
    local_shells(app)
        .into_iter()
        .find(|(id, _)| id == session_id)
        .map(|(_, pid)| pid)
        .ok_or_else(|| "That terminal is not a running local session.".to_string())
}

/// Run blocking process work off the async runtime, as the Always Awake poller does.
async fn blocking<R: Runtime, T: Send + 'static>(
    app: &AppHandle<R>,
    work: impl FnOnce(&AgentQuotaState) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app
            .try_state::<AgentQuotaState>()
            .ok_or_else(|| "Agent Quota is not initialised".to_string())?;
        work(&state)
    })
    .await
    .map_err(|e| format!("Agent Quota worker failed: {e}"))?
}

#[tauri::command]
pub async fn agent_quota_detect<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<SessionAgent>, String> {
    let shells = local_shells(&app);
    blocking(&app, move |state| Ok(state.detect(&shells))).await
}

#[tauri::command]
pub async fn agent_quota_suspend<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    pid: u32,
    start_time: u64,
) -> Result<SuspendReport, String> {
    let shell = session_shell(&app, &session_id)?;
    blocking(&app, move |state| {
        state.suspend(&session_id, shell, pid, start_time)
    })
    .await
}

#[tauri::command]
pub async fn agent_quota_resume<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
) -> Result<usize, String> {
    blocking(&app, move |state| {
        let held = state.take_held(&session_id);
        Ok(state.resume_targets(held))
    })
    .await
}

#[tauri::command]
pub async fn agent_quota_resume_all<R: Runtime>(app: AppHandle<R>) -> Result<usize, String> {
    blocking(&app, |state| Ok(state.resume_all())).await
}

#[tauri::command]
pub async fn agent_quota_terminate<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    pid: u32,
    start_time: u64,
) -> Result<usize, String> {
    let shell = session_shell(&app, &session_id)?;
    blocking(&app, move |state| {
        state.terminate(&session_id, shell, pid, start_time)
    })
    .await
}

#[tauri::command]
pub async fn agent_quota_get_held<R: Runtime>(
    app: AppHandle<R>,
    session_id: Option<String>,
) -> Result<Vec<ProcTarget>, String> {
    blocking(&app, move |state| {
        Ok(state.get_held(session_id.as_deref()))
    })
    .await
}

#[tauri::command]
pub async fn agent_quota_resume_pid<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    pid: u32,
) -> Result<bool, String> {
    blocking(&app, move |state| {
        state.resume_pid(&session_id, pid)
    })
    .await
}

#[cfg(test)]
#[path = "agent_quota_tests.rs"]
mod tests;
