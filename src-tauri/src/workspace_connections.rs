//! Connection profiles stored per real folder root at `<folder>/.omniterm/connections.json`.
//!
//! Composite workspaces aggregate those files for the renderer. `parentId` is namespaced with the
//! workspace-folder id while crossing IPC. The app only reads these files: they resolve saved
//! sessions at launch and list a workspace's connections; nothing in the app writes them.

use crate::connections::Connection;
use crate::safepath;
use crate::workspace::{find_workspace, WorkspaceFolder};
use app_core::workspace_model::namespace_path;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

#[cfg(test)]
#[path = "workspace_connections_tests.rs"]
mod tests;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceConnectionsFile {
    pub connections: Vec<Connection>,
}

fn connections_path(workspace_path: &str) -> Result<PathBuf, String> {
    let dir = safepath::safe_subdir(workspace_path, ".omniterm", false)?;
    Ok(dir.join("connections.json"))
}

pub fn read_at(workspace_path: &str) -> Result<Vec<Connection>, String> {
    let Ok(path) = connections_path(workspace_path) else {
        return Ok(Vec::new());
    };
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Cannot read workspace connections: {error}"))?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    let parsed: WorkspaceConnectionsFile = serde_json::from_str(&content)
        .map_err(|error| format!("connections.json is corrupt ({error})."))?;
    Ok(parsed.connections)
}

fn namespace_connection(folder: &WorkspaceFolder, mut connection: Connection) -> Connection {
    let parent = connection.parent_id.take().unwrap_or_default();
    connection.parent_id = Some(namespace_path(&folder.id, &parent));
    connection
}

fn load_for_folder(folder: &WorkspaceFolder) -> Result<Vec<Connection>, String> {
    Ok(read_at(&folder.path)?
        .into_iter()
        .map(|connection| namespace_connection(folder, connection))
        .collect())
}

pub fn find_by_id<R: Runtime>(app: &AppHandle<R>, conn_id: &str) -> Option<Connection> {
    for workspace in crate::workspace::read_workspaces(app).ok()? {
        for folder in workspace.folders {
            if let Ok(connections) = read_at(&folder.path) {
                if let Some(found) = connections
                    .into_iter()
                    .find(|connection| connection.id == conn_id)
                {
                    return Some(found);
                }
            }
        }
    }
    None
}

#[tauri::command]
pub async fn load_workspace_connections<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
) -> Result<Vec<Connection>, String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    let mut result = Vec::new();
    for folder in &workspace.folders {
        result.extend(load_for_folder(folder)?);
    }
    Ok(result)
}
