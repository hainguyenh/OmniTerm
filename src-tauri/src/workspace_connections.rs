//! Connection profiles stored per real folder root at `<folder>/.omniterm/connections.json`.
//!
//! Composite workspaces aggregate those files for the renderer. `parentId` is namespaced with the
//! workspace-folder id while crossing IPC, then stripped before a folder-local file or plugin scope
//! is read/written.

use crate::connections::Connection;
use crate::safepath;
use crate::workspace::{find_workspace, Workspace, WorkspaceFolder};
use app_core::workspace_model::namespace_path;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

#[cfg(test)]
#[path = "workspace_connections_tests.rs"]
mod tests;

const MAX_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceConnectionsFile {
    pub connections: Vec<Connection>,
}

fn connections_path(workspace_path: &str, create: bool) -> Result<PathBuf, String> {
    let dir = safepath::safe_subdir(workspace_path, ".omniterm", create)?;
    Ok(dir.join("connections.json"))
}

pub fn read_at(workspace_path: &str) -> Result<Vec<Connection>, String> {
    let Ok(path) = connections_path(workspace_path, false) else {
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

fn write_at(workspace_path: &str, connections: Vec<Connection>) -> Result<(), String> {
    let file_data = WorkspaceConnectionsFile { connections };
    let json = serde_json::to_string_pretty(&file_data).map_err(|error| error.to_string())?;
    if json.len() > MAX_BYTES {
        return Err("Connections file too large (max 1 MB).".to_string());
    }
    let path = connections_path(workspace_path, true)?;
    fs::write(path, json).map_err(|error| error.to_string())
}

fn scope(workspace: &Workspace, folder: &WorkspaceFolder) -> serde_json::Value {
    serde_json::json!({
        "kind": "workspace",
        "workspaceId": &workspace.id,
        "workspacePath": &folder.path,
    })
}

fn namespace_connection(folder: &WorkspaceFolder, mut connection: Connection) -> Connection {
    let parent = connection.parent_id.take().unwrap_or_default();
    connection.parent_id = Some(namespace_path(&folder.id, &parent));
    connection
}

fn local_connection(
    workspace: &Workspace,
    folder: &WorkspaceFolder,
    mut connection: Connection,
) -> Result<Option<Connection>, String> {
    let parent = connection.parent_id.clone().unwrap_or_default();
    if parent.is_empty() {
        if workspace.folders.len() != 1 || workspace.folders[0].id != folder.id {
            return Ok(None);
        }
        connection.parent_id = None;
        return Ok(Some(connection));
    }
    if parent == folder.id {
        connection.parent_id = None;
        return Ok(Some(connection));
    }
    let prefix = format!("{}/", folder.id);
    if let Some(relative) = parent.strip_prefix(&prefix) {
        connection.parent_id = if relative.is_empty() { None } else { Some(relative.to_string()) };
        return Ok(Some(connection));
    }
    Ok(None)
}

fn validate_connection_targets(workspace: &Workspace, data: &[Connection]) -> Result<(), String> {
    for connection in data {
        let parent = connection.parent_id.as_deref().unwrap_or_default();
        if parent.is_empty() {
            if workspace.folders.len() != 1 {
                return Err("Choose a workspace folder for each connection.".to_string());
            }
            continue;
        }
        let folder_id = parent.split('/').next().unwrap_or_default();
        if !workspace.folders.iter().any(|folder| folder.id == folder_id) {
            return Err(format!("Connection targets unknown workspace folder \"{folder_id}\"."));
        }
    }
    Ok(())
}

async fn load_for_folder(
    host: &crate::plugin_host::PluginHost,
    workspace: &Workspace,
    folder: &WorkspaceFolder,
) -> Result<Vec<Connection>, String> {
    if let Ok(Some(value)) = host.load_scoped_connections(scope(workspace, folder)).await {
        if let Ok(tree) = serde_json::from_value::<crate::connections::ConnectionTree>(value) {
            return Ok(tree
                .connections
                .into_iter()
                .map(|connection| namespace_connection(folder, connection))
                .collect());
        }
    }
    Ok(read_at(&folder.path)?
        .into_iter()
        .map(|connection| namespace_connection(folder, connection))
        .collect())
}

async fn save_for_folder(
    host: &crate::plugin_host::PluginHost,
    workspace: &Workspace,
    folder: &WorkspaceFolder,
    connections: Vec<Connection>,
) -> Result<(), String> {
    let tree = crate::connections::ConnectionTree {
        connections: connections.clone(),
        folders: Vec::new(),
    };
    let value = serde_json::to_value(&tree).map_err(|error| error.to_string())?;
    if let Ok(true) = host.save_scoped_connections(scope(workspace, folder), value).await {
        return Ok(());
    }
    write_at(&folder.path, connections)
}

pub fn find_by_id<R: Runtime>(app: &AppHandle<R>, conn_id: &str) -> Option<Connection> {
    for workspace in crate::workspace::read_workspaces(app).ok()? {
        for folder in workspace.folders {
            if let Ok(connections) = read_at(&folder.path) {
                if let Some(found) = connections.into_iter().find(|connection| connection.id == conn_id) {
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
    host: tauri::State<'_, crate::plugin_host::PluginHost>,
    workspace_id: String,
) -> Result<Vec<Connection>, String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    let mut result = Vec::new();
    for folder in &workspace.folders {
        result.extend(load_for_folder(&host, &workspace, folder).await?);
    }
    Ok(result)
}

#[tauri::command]
pub async fn save_workspace_connections<R: Runtime>(
    app: AppHandle<R>,
    host: tauri::State<'_, crate::plugin_host::PluginHost>,
    workspace_id: String,
    data: Vec<Connection>,
) -> Result<(), String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    if workspace.folders.is_empty() && !data.is_empty() {
        return Err("Add a folder before saving a workspace connection.".to_string());
    }
    validate_connection_targets(&workspace, &data)?;
    for folder in &workspace.folders {
        let mut local = Vec::new();
        for connection in data.iter().cloned() {
            if let Some(connection) = local_connection(&workspace, folder, connection)? {
                local.push(connection);
            }
        }
        save_for_folder(&host, &workspace, folder, local).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_workspace_connection<R: Runtime>(
    app: AppHandle<R>,
    host: tauri::State<'_, crate::plugin_host::PluginHost>,
    workspace_id: String,
    connection_id: String,
) -> Result<(), String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    for folder in &workspace.folders {
        let mut current = load_for_folder(&host, &workspace, folder).await?;
        let before = current.len();
        current.retain(|connection| connection.id != connection_id);
        if current.len() == before {
            continue;
        }
        let mut local = Vec::new();
        for connection in current {
            if let Some(connection) = local_connection(&workspace, folder, connection)? {
                local.push(connection);
            }
        }
        save_for_folder(&host, &workspace, folder, local).await?;
        return Ok(());
    }
    Ok(())
}
