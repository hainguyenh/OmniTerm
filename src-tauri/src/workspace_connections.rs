//! Connection profiles stored inside a workspace, at `<workspace>/.omniterm/connections.json`.
//!
//! Split out of workspace.rs, which was already over the per-file line limit — and these belong
//! together anyway: the file format, the two commands that read and write it, and the by-id lookup
//! that makes a workspace connection launchable are one concern.
//!
//! Workspace-scoped rather than global so a connection can travel with the project it belongs to (and
//! be committed alongside it). Like every other connection record in OmniTerm, `Connection` has no
//! field for a secret, so this file cannot hold one.

use crate::connections::Connection;
use crate::safepath;
use crate::workspace::find_workspace;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

#[cfg(test)]
#[path = "workspace_connections_tests.rs"]
mod tests;

/// Refuses a file large enough to suggest something other than hand-managed profiles wrote it.
const MAX_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceConnectionsFile {
    pub connections: Vec<Connection>,
}

/// The validated path to a workspace's connections file.
///
/// Validation runs before anything touches the filesystem. The first version called
/// `fs::create_dir_all` on the unvalidated join and only then validated, so a workspace path that
/// failed validation had already had a directory created inside it. Creating it afterwards instead was
/// no better: `safe_subdir` canonicalizes, canonicalizing a path that does not exist yet fails, and so
/// the very first save into a workspace could never get past validation. `safe_subdir` owns both
/// halves now, in the one order that is both safe and able to make the directory.
fn connections_path(workspace_path: &str, create: bool) -> Result<PathBuf, String> {
    let dir = safepath::safe_subdir(workspace_path, ".omniterm", create)?;
    Ok(dir.join("connections.json"))
}

/// Read the profiles saved in `workspace_path`, or an empty list if there are none.
///
/// Generic over the runtime and taking a path rather than a workspace id, so `pty_resolve` can consult
/// it while resolving a connection for launch.
pub fn read_at(workspace_path: &str) -> Result<Vec<Connection>, String> {
    let Ok(path) = connections_path(workspace_path, false) else {
        return Ok(Vec::new());
    };
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Cannot read workspace connections: {e}"))?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    let parsed: WorkspaceConnectionsFile = serde_json::from_str(&content)
        .map_err(|e| format!("connections.json is corrupt ({e})."))?;
    Ok(parsed.connections)
}

/// Find a saved profile by id across every registered workspace.
///
/// Without this, a workspace connection could be created and displayed but never launched:
/// `pty_resolve` consulted only the ad-hoc registry and the global tree, so connecting one failed with
/// `Unknown connection "…"`. A corrupt or unreadable workspace is skipped rather than failing the
/// lookup — one bad project folder must not make every other workspace's connections unlaunchable.
pub fn find_by_id<R: Runtime>(app: &AppHandle<R>, conn_id: &str) -> Option<Connection> {
    for workspace in crate::workspace::read_workspaces(app).ok()? {
        if let Ok(conns) = read_at(&workspace.path) {
            if let Some(found) = conns.into_iter().find(|c| c.id == conn_id) {
                return Some(found);
            }
        }
    }
    None
}

#[tauri::command]
pub async fn load_workspace_connections<R: Runtime>(
    app: AppHandle<R>,
    host: tauri::State<'_, crate::plugin_host::PluginHost>,
    workspace_id: String,
) -> Result<Vec<Connection>, String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    let scope = serde_json::json!({
        "kind": "workspace",
        "workspaceId": &workspace.id,
        "workspacePath": &workspace.path,
    });
    if let Ok(Some(value)) = host.load_scoped_connections(scope).await {
        if let Ok(tree) = serde_json::from_value::<crate::connections::ConnectionTree>(value) {
            return Ok(tree.connections);
        }
    }
    read_at(&workspace.path)
}

#[tauri::command]
pub async fn save_workspace_connections<R: Runtime>(
    app: AppHandle<R>,
    host: tauri::State<'_, crate::plugin_host::PluginHost>,
    workspace_id: String,
    data: Vec<Connection>,
) -> Result<(), String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    let scope = serde_json::json!({
        "kind": "workspace",
        "workspaceId": &workspace.id,
        "workspacePath": &workspace.path,
    });
    let tree = crate::connections::ConnectionTree {
        connections: data.clone(),
        folders: Vec::new(),
    };
    let value = serde_json::to_value(&tree).map_err(|e| e.to_string())?;
    if let Ok(true) = host.save_scoped_connections(scope, value).await {
        return Ok(());
    }

    // Serialized from `WorkspaceConnectionsFile`, not from the caller's JSON: a webview that posts an
    // extra `password` key gets it dropped at deserialization rather than written back out. Same
    // reasoning as `connections::save_connections`.
    let file_data = WorkspaceConnectionsFile { connections: data };
    let json = serde_json::to_string_pretty(&file_data).map_err(|e| e.to_string())?;
    if json.len() > MAX_BYTES {
        return Err("Connections file too large (max 1 MB).".to_string());
    }

    // Only create the directory once the payload is known good, so a rejected write leaves no trace.
    let path = connections_path(&workspace.path, true)?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_workspace_connection<R: Runtime>(
    app: AppHandle<R>,
    host: tauri::State<'_, crate::plugin_host::PluginHost>,
    workspace_id: String,
    connection_id: String,
) -> Result<(), String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    let scope = serde_json::json!({
        "kind": "workspace",
        "workspaceId": &workspace.id,
        "workspacePath": &workspace.path,
    });
    if let Ok(Some(value)) = host.load_scoped_connections(scope.clone()).await {
        if let Ok(mut tree) = serde_json::from_value::<crate::connections::ConnectionTree>(value) {
            tree.connections.retain(|connection| connection.id != connection_id);
            let data = serde_json::to_value(tree).map_err(|e| e.to_string())?;
            if host.save_scoped_connections(scope, data).await.unwrap_or(false) {
                return Ok(());
            }
        }
    }
    let mut conns = read_at(&workspace.path)?;
    let before = conns.len();
    conns.retain(|c| c.id != connection_id);
    if conns.len() != before {
        let file_data = WorkspaceConnectionsFile { connections: conns };
        let json = serde_json::to_string_pretty(&file_data).map_err(|e| e.to_string())?;
        let path = connections_path(&workspace.path, true)?;
        fs::write(path, json).map_err(|e| e.to_string())?;
    }
    Ok(())
}
