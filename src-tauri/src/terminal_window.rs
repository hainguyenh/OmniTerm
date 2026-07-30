//! Popping a pane out into its own OS window, and folding it back in.
//!
//! The PTY already lives here, in `PtyManager`'s app-global map, so a second window drives it with
//! the same `send_session_input` / `resize_session` commands the main one uses — there is no session
//! ownership to transfer. What does have to move is the *output sink*: a `tauri::ipc::Channel`
//! belongs to the webview that created it, so detaching parks the sink and attaching installs a new
//! one, replaying the scrollback in between (see session_output.rs).
//!
//! A detached window identifies itself by its **label**, not by a URL parameter. `getCurrentWindow()`
//! is synchronous in the webview, so the renderer can decide which root view to render before its
//! first await, and `bootstrap` resolves the rest from the calling window — meaning a webview cannot
//! ask about a window it does not own.

use crate::pty::{self, PtyManager, SessionStatus};
use crate::session_output::AttachSnapshot;
use dashmap::DashMap;
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent};

#[cfg(test)]
#[path = "terminal_window_tests.rs"]
mod tests;

/// Label prefix for detached windows. The capability file grants `term-*` the same permissions as
/// `main`; anything outside that prefix gets nothing, so the prefix is load-bearing.
pub const LABEL_PREFIX: &str = "term-";

/// Event the main window listens on to reclaim a folded-back pane.
const REATTACHED_EVENT: &str = "terminal-window-reattached";

const MAIN_WINDOW: &str = "main";

pub struct DetachEntry {
    pub window_label: String,
    pub name: String,
    /// The renderer's `Connection` record, passed straight back to the detached window so it can
    /// mount a terminal without re-resolving anything.
    pub connection: Value,
    /// Set by `reattach_terminal` before it closes the window, so the close handler folds the
    /// session back instead of consulting the busy flag.
    pub folding_back: AtomicBool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapInfo {
    pub session_id: String,
    pub name: String,
    pub connection: Value,
}

pub struct DetachRegistry {
    /// session id → the window showing it.
    entries: DashMap<String, DetachEntry>,
    next_label: AtomicU64,
    /// Set once the app starts tearing down. Quitting closes every window, and without this each
    /// detached window's close handler would run its kill-or-fold branch during shutdown — killing
    /// sessions on the way out, or emitting fold-back events at a main window that is also going.
    shutting_down: AtomicBool,
}

impl DetachRegistry {
    pub fn new() -> Self {
        Self {
            entries: DashMap::new(),
            next_label: AtomicU64::new(1),
            shutting_down: AtomicBool::new(false),
        }
    }

    pub fn begin_shutdown(&self) {
        self.shutting_down.store(true, Ordering::SeqCst);
    }

    /// Mint a label. Deliberately a counter rather than anything derived from the session id: a
    /// LOCAL pane's id is `<connId>_<uuid>`, which contains characters outside the set Tauri accepts
    /// for a window label.
    fn mint_label(&self) -> String {
        format!(
            "{LABEL_PREFIX}{}",
            self.next_label.fetch_add(1, Ordering::SeqCst)
        )
    }

    fn session_for_window(&self, label: &str) -> Option<String> {
        self.entries
            .iter()
            .find(|e| e.window_label == label)
            .map(|e| e.key().clone())
    }
}

impl Default for DetachRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Pop `session_id` out into its own window. Returns false if it is already detached or the window
/// could not be created — the renderer leaves the tab in place on false.
#[tauri::command]
pub async fn detach_terminal<R: Runtime>(
    app: AppHandle<R>,
    registry: tauri::State<'_, DetachRegistry>,
    pty: tauri::State<'_, PtyManager>,
    session_id: String,
    name: String,
    connection: Value,
) -> Result<bool, String> {
    if registry.entries.contains_key(&session_id) {
        return Ok(false);
    }
    let Some(session) = pty.sessions.get(&session_id) else {
        return Ok(false);
    };
    let output = std::sync::Arc::clone(&session.output);
    drop(session); // Release the shard guard before building a window.

    let label = registry.mint_label();
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title(&name)
        .inner_size(900.0, 600.0)
        .min_inner_size(400.0, 200.0)
        .decorations(false)
        .build()
        .map_err(|e| format!("Could not open a window for this session: {e}"))?;

    // Park the sink only once the window exists. Doing it earlier would blank the pane in the main
    // window on a failed build, with nothing to show it instead.
    if let Ok(mut out) = output.lock() {
        out.detach();
    }

    registry.entries.insert(
        session_id.clone(),
        DetachEntry {
            window_label: label.clone(),
            name,
            connection,
            folding_back: AtomicBool::new(false),
        },
    );

    // The closure carries its own session id rather than scanning for windows that have disappeared:
    // whether a window is still in `get_webview_window` at `Destroyed` time is a runtime detail, and
    // guessing wrong would strand the session with no sink and no way back.
    let handle = app.clone();
    let closed_session = session_id.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            on_window_destroyed(&handle, &closed_session);
        }
    });

    Ok(true)
}

/// What the detached window asks for on mount: which session it is showing, and how to label it.
#[tauri::command]
pub async fn bootstrap_terminal_window<R: Runtime>(
    window: tauri::Window<R>,
    registry: tauri::State<'_, DetachRegistry>,
) -> Result<Option<BootstrapInfo>, String> {
    // Resolved from the CALLING window's label, so a webview can only ever learn about itself.
    let Some(session_id) = registry.session_for_window(window.label()) else {
        return Ok(None);
    };
    Ok(registry.entries.get(&session_id).map(|entry| BootstrapInfo {
        session_id: session_id.clone(),
        name: entry.name.clone(),
        connection: entry.connection.clone(),
    }))
}

/// Bind the caller's channels to a live session and replay its scrollback.
///
/// Used by any window mounting a terminal in `attach` mode — the detached window on open, and the
/// main window when a pane folds back in.
#[tauri::command]
pub async fn attach_session(
    pty: tauri::State<'_, PtyManager>,
    id: String,
    on_data: Channel<Response>,
    on_status: Channel<SessionStatus>,
) -> Result<Option<AttachSnapshot>, String> {
    let Some(session) = pty.sessions.get(&id) else {
        // The shell exited while the window was opening. `None` is not an error: the renderer shows
        // "session is no longer available" in the pane rather than an error dialog.
        return Ok(None);
    };
    let output = std::sync::Arc::clone(&session.output);
    drop(session);

    let mut out = output
        .lock()
        .map_err(|_| "This session's output lock is poisoned.".to_string())?;
    Ok(Some(out.attach(on_data, on_status)))
}

/// Fold a detached pane back into the main window.
#[tauri::command]
pub async fn reattach_terminal<R: Runtime>(
    app: AppHandle<R>,
    registry: tauri::State<'_, DetachRegistry>,
    id: String,
) -> Result<bool, String> {
    let Some(entry) = registry.entries.get(&id) else {
        return Ok(false);
    };
    // Marked before the close so the handler folds unconditionally — an explicit Re-attach must not
    // be second-guessed by the idle check that governs the window's X button.
    entry.folding_back.store(true, Ordering::SeqCst);
    let label = entry.window_label.clone();
    drop(entry);

    match app.get_webview_window(&label) {
        Some(window) => window.close().map_err(|e| e.to_string())?,
        // No window to close (already gone): fold now so the session is not stranded sinkless.
        None => finish_reattach(&app, &id),
    }
    Ok(true)
}

#[tauri::command]
pub async fn focus_terminal_window<R: Runtime>(
    app: AppHandle<R>,
    registry: tauri::State<'_, DetachRegistry>,
    id: String,
) -> Result<(), String> {
    if let Some(entry) = registry.entries.get(&id) {
        if let Some(window) = app.get_webview_window(&entry.window_label) {
            let _ = window.set_focus();
        }
    }
    Ok(())
}

/// Forget a session without touching its window — used when the pane is closed outright.
#[tauri::command]
pub async fn release_terminal_window(
    registry: tauri::State<'_, DetachRegistry>,
    id: String,
) -> Result<(), String> {
    registry.entries.remove(&id);
    Ok(())
}

/// Decide what a destroyed detached window means for its session.
///
/// Three cases, in order:
///   * the app is quitting — do nothing; every window is closing and the sessions go with the process;
///   * an explicit Re-attach — fold back, regardless of what the shell is doing;
///   * the user closed the window — fold back if the shell is *busy* (never lose running work to a
///     mis-click), otherwise kill the session, which is what closing a terminal window normally means.
fn on_window_destroyed<R: Runtime>(app: &AppHandle<R>, session_id: &str) {
    let Some(registry) = app.try_state::<DetachRegistry>() else {
        return;
    };
    if registry.shutting_down.load(Ordering::SeqCst) {
        return;
    }
    // Already handled (a `release` from the renderer, or a second Destroyed) — nothing left to do.
    let Some(entry) = registry.entries.get(session_id) else {
        return;
    };
    let folding = entry.folding_back.load(Ordering::SeqCst);
    drop(entry);

    if folding || session_is_busy(app, session_id) {
        finish_reattach(app, session_id);
    } else {
        registry.entries.remove(session_id);
        if let Some(pty) = app.try_state::<PtyManager>() {
            log::info!("[terminal-window] closing idle detached session {session_id}");
            pty::kill_session(&pty, session_id);
        }
    }
}

/// Is the shell running something? Derived from the activity poller's debounced view, so it means
/// "has a descendant process", not "has unsaved work".
fn session_is_busy<R: Runtime>(app: &AppHandle<R>, session_id: &str) -> bool {
    let Some(pty) = app.try_state::<PtyManager>() else {
        return false;
    };
    let Some(session) = pty.sessions.get(session_id) else {
        return false;
    };
    session.output.lock().map(|out| out.busy()).unwrap_or(false)
}

/// Drop the registry entry and tell the main window to reclaim the pane. The tab remounts in
/// `attach` mode, which calls `attach_session` and gets the scrollback back.
fn finish_reattach<R: Runtime>(app: &AppHandle<R>, session_id: &str) {
    if let Some(registry) = app.try_state::<DetachRegistry>() {
        registry.entries.remove(session_id);
    }
    if let Some(main) = app.get_webview_window(MAIN_WINDOW) {
        let _ = main.emit(REATTACHED_EVENT, session_id);
        let _ = main.set_focus();
    }
}
