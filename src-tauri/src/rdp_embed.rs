//! Launching an RDP session for a saved connection.
//!
//! # Ownership
//!
//! RDP belongs to a plugin, not to the host. A plugin that registers a `ConnectionProvider` runs in the
//! sidecar and can spawn whatever client it likes (`mstsc`, `freerdp`, `vncviewer`), with whatever
//! credential policy that deployment wants. What remains here is the no-plugin fallback: the
//! pre-existing, credential-free `mstsc` launch, so RDP still works on a stock install.
//!
//! This module deliberately does **not** embed the client window into a pane. It used to advertise that
//! it did — `rdp_set_bounds` and `rdp_set_visible` were registered commands whose bodies were empty, so
//! the renderer positioned a window that was never reparented and got no error telling it so. They are
//! gone; a command that silently succeeds while doing nothing is worse than one that is absent.
//!
//! If docking is built later, it should stay plugin-owned: the host would expose a *generic* reverse RPC
//! (`host.embedWindow({ paneId, pid })` / `host.setEmbedBounds` / `host.releaseWindow`) that reparents
//! any external process's top-level window into a pane rect. The plugin spawns the client and hands over
//! a pid; the host learns nothing about RDP and touches no credential. Do not re-add RDP-specific
//! commands to the host to get there.
//!
//! # Credentials
//!
//! The generated `.rdp` file carries host, port and username only. No `password 51:b:` blob, no
//! `prompt for credentials`, no `cmdkey`, and nothing on the command line — the client prompts the user.
//! Keep it that way: a password on argv is readable by any process on the machine, and one in the file
//! is a password OmniTerm wrote to disk.

use crate::connections::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[cfg(test)]
#[path = "rdp_embed_tests.rs"]
mod tests;

/// Prefix for the temporary `.rdp` files this module writes, and the startup sweep that removes them.
const TEMP_PREFIX: &str = "omniterm_rdp_";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdpBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub dpr: f64,
}

pub struct RdpSessionManager {
    sessions: Mutex<std::collections::HashMap<String, RdpSession>>,
    /// Makes each launch's temp file unique. Two panes on one connection shared a single path, so
    /// disconnecting either deleted the file the other was still identified by.
    seq: AtomicU64,
}

struct RdpSession {
    temp_file: PathBuf,
}

impl Default for RdpSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl RdpSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(std::collections::HashMap::new()),
            seq: AtomicU64::new(0),
        }
    }

    fn next_seq(&self) -> u64 {
        self.seq.fetch_add(1, Ordering::SeqCst)
    }

    pub fn register(&self, id: String, temp_file: PathBuf) {
        let mut map = self.sessions.lock().unwrap();
        map.insert(id, RdpSession { temp_file });
    }

    pub fn remove(&self, id: &str) -> Option<PathBuf> {
        let mut map = self.sessions.lock().unwrap();
        map.remove(id).map(|s| s.temp_file)
    }
}

/// Generate `.rdp` configuration content from a Connection.
///
/// Credential-free by construction — see the module note. `Connection` has no password field, so there
/// is nothing here that could write one even by accident.
pub fn generate_rdp_content(conn: &Connection) -> String {
    let port = if conn.port.is_empty() {
        "3389"
    } else {
        &conn.port
    };
    let redirect = if conn.redirect_drives.unwrap_or(false) {
        1
    } else {
        0
    };

    format!(
        "full address:s:{}:{}\n\
         username:s:{}\n\
         redirectdrives:i:{}\n\
         screen mode id:i:1\n\
         desktopwidth:i:1920\n\
         desktopheight:i:1080\n\
         session bpp:i:32\n\
         compression:i:1\n\
         keyboardhook:i:2\n\
         displayconnectionbar:i:0\n",
        conn.host, port, conn.user, redirect
    )
}

/// Temp-file name for one launch. `seq` keeps concurrent sessions to the same connection distinct.
pub fn temp_file_name(conn_id: &str, seq: u64) -> String {
    let safe: String = conn_id
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    format!("{TEMP_PREFIX}{safe}_{seq}.rdp")
}

/// Delete `.rdp` files left behind by a previous run.
///
/// These carry a hostname and a username. Nothing waited on the client process and the session map was
/// dropped at exit without unlinking, so every session leaked its file into the cache directory
/// permanently. Best-effort: a failure here must not stop the app from launching.
pub fn sweep_stale_temp_files<R: Runtime>(app: &AppHandle<R>) {
    let Ok(dir) = app.path().app_cache_dir() else {
        return;
    };
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.starts_with(TEMP_PREFIX) && name.ends_with(".rdp") {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Create a temporary `.rdp` file for launching the client.
fn create_temp_rdp_file<R: Runtime>(
    app: &AppHandle<R>,
    conn: &Connection,
    seq: u64,
) -> Result<PathBuf, String> {
    let temp_dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let temp_file = temp_dir.join(temp_file_name(&conn.id, seq));
    fs::write(&temp_file, generate_rdp_content(conn))
        .map_err(|e| format!("Failed to write temporary RDP file: {e}"))?;
    Ok(temp_file)
}

/// Remove a session's temp file and tell the renderer the session is over.
fn finish_session<R: Runtime>(app: &AppHandle<R>, id: &str, temp_file: Option<&Path>) {
    if let Some(path) = temp_file {
        let _ = fs::remove_file(path);
    }
    let _ = app.emit(&format!("rdp-closed-{id}"), ());
}

#[tauri::command]
pub async fn connect_rdp<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<serde_json::Value, String> {
    // Resolves through the ad-hoc registry, the global tree, workspace profiles, then a plugin's
    // `ConnectionProvider`. A plugin owning the tree therefore also owns what gets launched from it.
    let conn = crate::pty_resolve::resolve_connection_by_id(&app, &id).await?;
    if conn.conn_type != "RDP" {
        return Err("Not an RDP connection.".to_string());
    }

    if let Some(batch) = crate::pty_resolve::native_batch_launch(&app, &id, "detached").await? {
        crate::pty_resolve::require_windows_client(
            "mstsc.exe",
            "Remote Desktop Connection is not installed. Contact your administrator or enable it in Windows optional features.",
        )?;
        let mut launcher = std::process::Command::new("cmd.exe");
        launcher.args(["/d", "/c", "call", &batch]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            launcher.creation_flags(0x0800_0000); // CREATE_NO_WINDOW; mstsc owns the visible window.
        }
        let mut child = launcher
            .spawn()
            .map_err(|error| format!("Failed to launch the generated RDP launcher: {error}"))?;
        let _ = app.emit(&format!("rdp-ready-{id}"), ());
        let watcher = app.clone();
        let watch_id = id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _ = child.wait();
            let _ = watcher.emit(&format!("rdp-closed-{watch_id}"), ());
        });
        return Ok(serde_json::json!({ "ok": true }));
    }

    let seq = app
        .try_state::<RdpSessionManager>()
        .map(|m| m.next_seq())
        .unwrap_or(0);
    let temp_file = create_temp_rdp_file(&app, &conn, seq)?;
    let path_str = temp_file.to_string_lossy().to_string();

    let (exe, args) = match crate::rdp_launch::rdp_command(&path_str, std::env::consts::OS) {
        Ok(cmd) => cmd,
        Err(e) => {
            let _ = fs::remove_file(&temp_file);
            return Err(e);
        }
    };

    let child = match std::process::Command::new(&exe).args(&args).spawn() {
        Ok(child) => child,
        Err(e) => {
            // Do not leave a file naming a host behind for a session that never started.
            let _ = fs::remove_file(&temp_file);
            let message = format!("Failed to launch RDP client: {e}");
            let _ = app.emit(&format!("rdp-error-{id}"), message.clone());
            return Err(message);
        }
    };

    if let Some(mgr) = app.try_state::<RdpSessionManager>() {
        mgr.register(id.clone(), temp_file.clone());
    }
    let _ = app.emit(&format!("rdp-ready-{id}"), ());

    // Reap the child rather than dropping it. Without this the client became a zombie on Unix, and
    // nothing ever told the renderer the session had ended — `rdp-closed` was subscribed but never
    // emitted, so a pane stayed "connected" after the user closed the window.
    let watcher = app.clone();
    let watch_id = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut child = child;
        let _ = child.wait();
        let temp = watcher
            .try_state::<RdpSessionManager>()
            .and_then(|m| m.remove(&watch_id));
        finish_session(&watcher, &watch_id, temp.as_deref());
    });

    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub async fn rdp_disconnect<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let temp = app
        .try_state::<RdpSessionManager>()
        .and_then(|m| m.remove(&id));
    finish_session(&app, &id, temp.as_deref());
    Ok(())
}
