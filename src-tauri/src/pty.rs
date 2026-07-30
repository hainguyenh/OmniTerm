//! Local terminal sessions: a real PTY per pane, streamed to the renderer.
//!
//! A pane reports ready/data/error/closed over two `tauri::ipc::Channel`s rather than global events
//! named `session-data-<id>`, for three reasons:
//!
//!   * Correctness: a session id may contain any character (LOCAL panes mint `<connId>_<uuid>`),
//!     while Tauri event names are restricted to `[A-Za-z0-9-/:_]`. An id outside that set made every
//!     `listen`/`emit` fail and left the pane stuck on "connecting" forever.
//!   * Isolation: a global event carrying a shell's output reaches every listener in the webview, so
//!     any script there could read another pane's bytes or forge its errors. A channel is reachable
//!     only through the callback its creator registered.
//!   * Throughput: a channel payload over 1 KiB is fetched as binary, skipping the JSON
//!     number-array encoding an event has to use for the same bytes.
//!
//! Which channels a session currently writes to can change — see session_output.rs.

use crate::launcher;
use crate::pty_resolve::resolve_local_launch;
use crate::session_output::{push_output, send_status, Output};
use dashmap::DashMap;
use portable_pty::{ChildKiller, CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Manager, Runtime};

/// Initial geometry. The renderer resizes as soon as xterm's fit addon has measured the pane; this
/// matches the 80x24 the Electron build opened with so the first prompt lands identically.
const INITIAL_COLS: u16 = 80;
const INITIAL_ROWS: u16 = 24;

/// Everything a pane reports that is not raw output. One tagged message instead of three channels,
/// so the renderer sees ready/error/closed in the order they happened.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SessionStatus {
    /// The PTY is live; `label` is the shell name to show in the pane banner.
    Ready { label: String },
    Error { message: String },
    Closed { code: u32 },
    /// The shell is (or is no longer) running something — see session_activity.rs. Sent on change
    /// only, so the renderer can hold it as a plain flag.
    Activity { busy: bool },
}

pub struct PtySession {
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    /// Kills the child directly. Dropping the master is not enough: the reader task holds a cloned
    /// reader handle that keeps the PTY alive, so without this a disconnected pane leaves its shell
    /// (and anything it spawned) running for the life of the app.
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    /// The shell's OS pid — the root of the descendant search that decides busy/idle. `None` when
    /// portable-pty could not report one, in which case the pane simply never reports busy.
    pub(crate) pid: Option<u32>,
    /// Where this session's bytes and status go, and the scrollback kept for whoever attaches next.
    /// Shared rather than owned by the reader task, so a pane can move between windows — see
    /// session_output.rs for why the buffer and the sink share one lock.
    pub(crate) output: Arc<Mutex<Output>>,
    /// This session baked a saved command into the shell's argv (see launch.rs). Such a pane reports
    /// busy from the start: the shell may not have forked the command yet, and a pure-batch script
    /// runs *inside* cmd.exe with no child process to find.
    pub(crate) launched_with_command: bool,
    /// Kill-on-close job holding the shell and its descendants (see win_job.rs). `kill_session` uses
    /// it so a manual disconnect reaps orphans the same way a natural exit does.
    #[cfg(windows)]
    job: Option<Arc<crate::win_job::JobHandle>>,
}

pub struct PtyManager {
    pub sessions: DashMap<String, PtySession>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
        }
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

/// PATH for a pane, with the launcher shim directory prepended so a script running inside the pane
/// can call `nc-open` to open another pane in this app instead of spawning a detached console.
fn path_with_helper<R: Runtime>(app: &AppHandle<R>) -> Option<OsString> {
    let bin_dir = launcher::launcher_bin_dir(app);
    let current = std::env::var_os("PATH")?;
    let mut parts = vec![bin_dir];
    parts.extend(std::env::split_paths(&current));
    std::env::join_paths(parts).ok()
}

/// Start a pane and stream it back over `on_data` (raw bytes) and `on_status` (ready/error/closed).
///
/// The channels come from the caller, which creates them with its callbacks already attached — so
/// unlike the event-based port there is no window between "the PTY is running" and "the renderer can
/// receive", and no bytes to lose in it.
#[tauri::command]
pub async fn start_local_session<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, PtyManager>,
    id: String,
    conn_id: String,
    shell: Option<String>,
    on_data: Channel<Response>,
    on_status: Channel<SessionStatus>,
) -> Result<(), String> {
    // Re-connecting with a live id would orphan the previous child; tear it down first.
    if state.sessions.contains_key(&id) {
        kill_session(&state, &id);
    }

    let launch = resolve_local_launch(&app, &conn_id, shell).await?;
    let invocation = launch.invocation()?;
    log::info!(
        "[pty] starting session {id} ({} {:?})",
        invocation.exe,
        invocation.args
    );

    let pair = NativePtySystem::default()
        .openpty(PtySize {
            rows: INITIAL_ROWS,
            cols: INITIAL_COLS,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Could not open a pseudo-terminal: {e}"))?;

    let mut cmd = CommandBuilder::new(&invocation.exe);
    for arg in &invocation.args {
        cmd.arg(arg);
    }
    if let Some(cwd) = &launch.cwd {
        cmd.cwd(cwd);
    }
    if let Some(path) = path_with_helper(&app) {
        cmd.env("PATH", path);
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Could not start {}: {e}", invocation.exe))?;

    // A script that shells out to `wsl.exe` (or similar) can leave a helper process running long after
    // the shell exits. The job lets the exit watcher below take that whole tree down instead of
    // leaking it for the life of the app. Best-effort: without one the pane just loses that cleanup.
    #[cfg(windows)]
    let job: Option<Arc<crate::win_job::JobHandle>> = match child.as_raw_handle() {
        Some(raw) => match crate::win_job::assign_new_job(raw) {
            Ok(job) => Some(Arc::new(job)),
            Err(e) => {
                log::warn!("[pty] could not create a job object for session {id}: {e}");
                None
            }
        },
        None => None,
    };

    // Drop our end of the slave: while it is open the reader never observes EOF when the shell exits.
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    // Read before `child` moves into the exit-watcher task below — that move is what makes this the
    // only place the pid can be captured.
    let pid = child.process_id();
    let launched_with_command = launch.command.is_some();

    let label = launch.shell.label().to_string();
    let output = Arc::new(Mutex::new(Output::new(on_data, on_status, label.clone())));

    state.sessions.insert(
        id.clone(),
        PtySession {
            master: Arc::new(Mutex::new(pair.master)),
            writer: Arc::new(Mutex::new(writer)),
            killer: Arc::new(Mutex::new(killer)),
            pid,
            output: Arc::clone(&output),
            launched_with_command,
            #[cfg(windows)]
            job: job.clone(),
        },
    );

    send_status(&output, SessionStatus::Ready { label });
    // Baseline activity, so the tab has a state before the poller's first tick lands.
    let busy = launched_with_command;
    send_status(&output, SessionStatus::Activity { busy });

    let reader_output = Arc::clone(&output);
    let reader_task = tokio::task::spawn_blocking(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                // Deliberately does not stop when the sink is dead — that is just a detached pane,
                // and the bytes go to its replay buffer. Breaking (as this did when there was only
                // ever one window) would kill a popped-out pane's output permanently.
                Ok(n) => push_output(&reader_output, &buf[..n]),
                Err(e) => {
                    send_status(
                        &reader_output,
                        SessionStatus::Error {
                            message: e.to_string(),
                        },
                    );
                    break;
                }
            }
        }
    });

    let app_clone = app.clone();
    let id_clone = id.clone();
    tokio::spawn(async move {
        // Wait on the shell itself rather than on the reader seeing EOF. A ConPTY reports EOF only once
        // OpenConsole considers every process attached to the console gone, so one orphaned descendant
        // (a stray `wsl.exe` helper) keeps the read blocked long after the shell has exited.
        let code = tokio::task::spawn_blocking(move || {
            child.wait().map(|s| s.exit_code()).unwrap_or(0)
        })
        .await
        .unwrap_or(0);

        // Take down whatever the shell left behind, so it does not linger in the background.
        #[cfg(windows)]
        if let Some(job) = &job {
            job.terminate(code);
        }

        // Drop the session — and with it `master`, whose Windows impl calls `ClosePseudoConsole` —
        // *before* joining the reader. That tears the pseudoconsole down at the OS level and is what
        // unblocks the pending read; joining first is what let an orphan hang the pane indefinitely.
        if let Some(manager) = app_clone.try_state::<PtyManager>() {
            manager.sessions.remove(&id_clone);
        }

        // Joined after, so buffered output still reaches the renderer ahead of Closed.
        let _ = reader_task.await;

        // Through the shared holder, not a captured channel: by now the pane may be living in a
        // detached window, and a clone taken at start time would deliver Closed to the dead one.
        send_status(&output, SessionStatus::Closed { code });
    });

    Ok(())
}

#[tauri::command]
pub async fn send_session_input(
    state: tauri::State<'_, PtyManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    let session = state.sessions.get(&id).ok_or("Session not found")?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "Failed to acquire writer lock".to_string())?;
    writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resize_session(
    state: tauri::State<'_, PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if cols == 0 || rows == 0 {
        return Err("Terminal size must be non-zero".to_string());
    }
    let session = state.sessions.get(&id).ok_or("Session not found")?;
    let master = session
        .master
        .lock()
        .map_err(|_| "Failed to acquire master lock".to_string())?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

/// Remove a session and kill its child. Idempotent.
///
/// Takes `&PtyManager` rather than the `State` wrapper so the detached-window close handler — which
/// only has an `AppHandle` — can reap an idle pane through the same path a disconnect uses.
pub(crate) fn kill_session(manager: &PtyManager, id: &str) {
    let Some((_, session)) = manager.sessions.remove(id) else {
        return;
    };
    let killer = Arc::clone(&session.killer);
    #[cfg(windows)]
    let job = session.job.clone();
    drop(session);

    let outcome = match killer.lock() {
        Ok(mut killer) => killer.kill().map_err(|e| e.to_string()),
        Err(_) => Err("killer lock is poisoned".to_string()),
    };
    // `Err` here is not evidence of failure on Windows: portable-pty 0.8.1's `WinChildKiller::kill`
    // inverts the `TerminateProcess` return-code check, so a *successful* kill comes back as `Err`
    // carrying a stale OS error ("The handle is invalid."). See the note in
    // tests/shell_integration.rs, which asserts the child really does die. The authoritative signal
    // is the reader task's `session-closed` emit, so this is logged rather than surfaced.
    if let Err(e) = outcome {
        log::debug!("[pty] kill for session {id} reported: {e}");
    }

    // Same orphan cleanup the natural-exit path does, so a disconnect does not leak descendants.
    #[cfg(windows)]
    if let Some(job) = job {
        job.terminate(1);
    }
}

#[tauri::command]
pub async fn disconnect_session(
    state: tauri::State<'_, PtyManager>,
    id: String,
) -> Result<(), String> {
    if !state.sessions.contains_key(&id) {
        return Err("Session not found".to_string());
    }
    kill_session(&state, &id);
    Ok(())
}
