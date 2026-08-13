//! Ad-hoc ("quick connect") shell panes, held in memory only and never persisted.
//!
//! Ports Electron's `openAdhocShell` / `shell:ready` / `shell:release` (electron/main.ts). A launch
//! request — from the cooperative `--open-shell` launcher, from the Workspace view, or from the
//! renderer's "new session" button — becomes a LOCAL connection with a generated `adhoc-…` id, which
//! is what `start_local_session` resolves.
//!
//! Two reasons this lives in the backend rather than the webview:
//!   * The renderer's `shells.onOpen` handler expects a full Connection record. The first port
//!     emitted a bare `{shell, cwd, …}` object from the frontend (and a raw argv array from the
//!     single-instance hook), neither of which the handler can use.
//!   * `start_local_session` has to resolve an `adhoc-…` id to its shell/cwd/command. Those params
//!     never appear in connections.json, so a webview-side lookup finds nothing and silently opens a
//!     bare default shell instead — or, for the "new session" button, fails outright because the
//!     `local-default-…` id it invented exists nowhere the backend can see.

use crate::openshell::OpenShellRequest;
use crate::shell_spec::LocalShell;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use uuid::Uuid;

#[cfg(test)]
#[path = "adhoc_tests.rs"]
mod tests;

/// Cap on opens queued while the renderer is not yet listening. The queue exists to cover the
/// unlock/cold-start window; any local process can drive `--open-shell`, so it stays bounded.
const MAX_PENDING_OPENS: usize = 64;

/// Queued `shell-open` payloads plus whether the renderer has reported that it can receive them.
#[derive(Default)]
pub struct PendingQueue {
    ready: bool,
    queue: Vec<Value>,
}

impl PendingQueue {
    /// Queue a payload. Returns false if the queue is full and the request was dropped.
    pub fn push(&mut self, payload: Value) -> bool {
        if self.queue.len() >= MAX_PENDING_OPENS {
            return false;
        }
        self.queue.push(payload);
        true
    }

    pub fn mark_ready(&mut self) {
        self.ready = true;
    }

    /// Take everything queued, but only once the renderer is listening. Before that the payloads
    /// stay put — the renderer only mounts after unlock, and an emit into a dead window is lost.
    pub fn drain_if_ready(&mut self) -> Vec<Value> {
        if !self.ready {
            return Vec::new();
        }
        std::mem::take(&mut self.queue)
    }
}

#[derive(Default)]
pub struct AdhocRegistry {
    conns: Mutex<HashMap<String, OpenShellRequest>>,
    pending: Mutex<PendingQueue>,
}

impl AdhocRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// The launch params behind an `adhoc-…` connection id, if it is still open.
    pub fn get(&self, conn_id: &str) -> Option<OpenShellRequest> {
        self.conns.lock().ok()?.get(conn_id).cloned()
    }

    fn insert(&self, conn_id: String, req: OpenShellRequest) {
        if let Ok(mut conns) = self.conns.lock() {
            conns.insert(conn_id, req);
        }
    }

    pub fn insert_named(&self, conn_id: String, req: OpenShellRequest) {
        self.insert(conn_id, req);
    }

    fn remove(&self, conn_id: &str) {
        if let Ok(mut conns) = self.conns.lock() {
            conns.remove(conn_id);
        }
    }
}

/// Build the Connection-shaped payload the renderer's `shells.onOpen` handler consumes. Field names
/// and the `LOCAL` type must match `RendererConnection` in electron/main.ts.
pub fn renderer_connection(conn_id: &str, req: &OpenShellRequest) -> Value {
    json!({
        "id": conn_id,
        "name": req.name,
        "type": "LOCAL",
        "host": "",
        "port": "",
        "user": "",
        "shell": req.shell.as_str(),
        "localCwd": req.cwd,
        "localCommand": req.command,
        "localArgs": req.args,
        "localKeepOpen": req.keep_open,
    })
}

fn renderer_connection_for_workspace(
    conn_id: &str,
    req: &OpenShellRequest,
    workspace_id: Option<&str>,
) -> Value {
    let mut payload = renderer_connection(conn_id, req);
    if let Some(workspace_id) = workspace_id {
        payload["workspaceId"] = json!(workspace_id);
    }
    payload
}

/// Register a validated launch request under a fresh id and return that id with the Connection
/// payload for it. `req` must already have come through `parse_open_shell_args`, `open_quick_shell`
/// or an equivalent allowlist — this function does not re-validate the shell.
///
/// The id uses `-`, not `#`: it becomes part of a pane's session id, and ids with characters outside
/// `[A-Za-z0-9-/:_]` used to break the renderer's event subscriptions outright. Session traffic no
/// longer travels on named events, but nothing gains from an id that only works because of that.
fn register<R: Runtime>(app: &AppHandle<R>, req: OpenShellRequest) -> (String, Value) {
    register_with_workspace(app, req, None)
}

fn register_with_workspace<R: Runtime>(
    app: &AppHandle<R>,
    req: OpenShellRequest,
    workspace_id: Option<&str>,
) -> (String, Value) {
    let conn_id = format!("adhoc-{}", Uuid::new_v4());
    let payload = renderer_connection_for_workspace(&conn_id, &req, workspace_id);
    app.state::<AdhocRegistry>().insert(conn_id.clone(), req);
    (conn_id, payload)
}

/// Register a request and hand it to the renderer (queuing if it is not listening yet).
///
/// Returns the generated `adhoc-…` connection id, which is what `start_local_session` resolves.
pub fn open_adhoc_shell<R: Runtime>(app: &AppHandle<R>, req: OpenShellRequest) -> String {
    let (conn_id, payload) = register(app, req);
    emit_registered_shell(app, conn_id, payload)
}

pub fn open_adhoc_shell_in_workspace<R: Runtime>(
    app: &AppHandle<R>,
    req: OpenShellRequest,
    workspace_id: &str,
) -> String {
    let (conn_id, payload) = register_with_workspace(app, req, Some(workspace_id));
    emit_registered_shell(app, conn_id, payload)
}

fn emit_registered_shell<R: Runtime>(
    app: &AppHandle<R>,
    conn_id: String,
    payload: Value,
) -> String {
    let registry = app.state::<AdhocRegistry>();

    let queued = match registry.pending.lock() {
        Ok(mut pending) => pending.push(payload),
        Err(_) => false,
    };
    if !queued {
        log::warn!("[adhoc] dropped a shell-open request: queue is full");
        return conn_id;
    }

    flush_pending(app);
    conn_id
}

/// Emit every queued open, once the renderer is listening. Brings the window forward first, the way
/// Electron's `flushPendingOpens` did — a launch from a script should surface the app.
pub fn flush_pending<R: Runtime>(app: &AppHandle<R>) {
    let ready = {
        let registry = app.state::<AdhocRegistry>();
        let Ok(mut pending) = registry.pending.lock() else {
            return;
        };
        pending.drain_if_ready()
    };
    if ready.is_empty() {
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    for payload in ready {
        if let Err(e) = app.emit("shell-open", payload) {
            log::warn!("[adhoc] failed to emit shell-open: {e}");
        }
    }
}

/// Build the launch request behind the renderer's "new session" button.
///
/// `shell` is untrusted and validated the same way launcher argv is: an unrecognized name, or one
/// that cannot exist on this platform, is refused rather than passed on to the spawner. An absent or
/// empty value means the platform default. A quick shell carries no cwd, command or extra args —
/// there is nothing for the webview to smuggle in.
pub fn quick_shell_request(shell: Option<&str>) -> Result<OpenShellRequest, String> {
    let requested = shell.unwrap_or_default();
    let parsed = LocalShell::parse(requested)
        .ok_or_else(|| format!("Unsupported shell \"{requested}\"."))?;
    if !parsed.is_supported_here() {
        return Err(format!(
            "The {} shell is not available on this platform.",
            parsed.as_str()
        ));
    }
    Ok(OpenShellRequest {
        shell: parsed,
        cwd: None,
        command: None,
        args: None,
        keep_open: true,
        name: parsed.default_name().to_string(),
    })
}

/// Register an unsaved shell and return its Connection record, without going through the
/// `shell-open` queue — the caller opens the pane itself. Nothing about the launch is decided in the
/// webview: the renderer used to invent a `local-default-…` id that resolved to nothing here.
#[tauri::command]
pub async fn open_quick_shell<R: Runtime>(
    app: AppHandle<R>,
    shell: Option<String>,
    workspace_id: Option<String>,
) -> Result<Value, String> {
    let mut req = quick_shell_request(shell.as_deref())?;
    if let Some(id) = workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        let workspace = crate::workspace::read_workspaces(&app)?
            .into_iter()
            .find(|workspace| workspace.id == id)
            .ok_or_else(|| format!("Unknown workspace \"{id}\"."))?;
        if !std::path::Path::new(&workspace.path).is_dir() {
            return Err("Workspace path is invalid.".to_string());
        }
        req.cwd = Some(workspace.path);
    }
    Ok(
        if let Some(workspace_id) = workspace_id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
        {
            register_with_workspace(&app, req, Some(workspace_id)).1
        } else {
            register(&app, req).1
        },
    )
}

/// The renderer reports it can receive `shell-open` (it only mounts after unlock). Flushes anything
/// queued while it was not listening.
#[tauri::command]
pub async fn shells_ready<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    {
        let registry = app.state::<AdhocRegistry>();
        let mut pending = registry
            .pending
            .lock()
            .map_err(|_| "adhoc queue is poisoned".to_string())?;
        pending.mark_ready();
    }
    flush_pending(&app);
    Ok(())
}

/// The renderer closed an ad-hoc tab — drop its in-memory params.
#[tauri::command]
pub async fn shells_release<R: Runtime>(app: AppHandle<R>, conn_id: String) -> Result<(), String> {
    app.state::<AdhocRegistry>().remove(&conn_id);
    Ok(())
}
