//! Workspace lifecycle commands: import a .code-workspace file, remove a
//! workspace (re-parenting children), and rename it. Folder membership lives in
//! workspace_folders.rs; scans and scripts live in workspace.rs.

use crate::workspace::{new_workspace, next_root_order};
use crate::workspace_folders::new_folder;
use crate::workspace_persistence::{read_workspaces, write_workspaces};
use app_core::workspace_model::{normalize_workspace_orders, parse_workspace_import};
pub use app_protocol::workspace::Workspace;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub async fn import_workspace_file<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<Workspace, String> {
    const MAX_IMPORT_BYTES: u64 = 1024 * 1024;
    let metadata =
        fs::metadata(&path).map_err(|error| format!("Cannot read workspace file: {error}"))?;
    if metadata.len() > MAX_IMPORT_BYTES {
        return Err("Workspace file is too large (max 1 MB).".to_string());
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Cannot read workspace file: {error}"))?;
    let imported = parse_workspace_import(Path::new(&path), &content)?;
    let mut list = read_workspaces(&app)?;
    let folders = imported
        .folders
        .into_iter()
        .map(|folder| new_folder(folder.path, Some(folder.name)))
        .collect();
    let workspace = new_workspace(imported.name, folders, next_root_order(&list));
    list.push(workspace.clone());
    write_workspaces(&app, &list)?;
    Ok(workspace)
}

#[tauri::command]
pub async fn remove_workspace<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let mut list = read_workspaces(&app)?;
    let parent = list
        .iter()
        .find(|workspace| workspace.id == id)
        .map(|workspace| workspace.parent_id.clone())
        .ok_or_else(|| format!("Unknown workspace \"{id}\""))?;
    for workspace in &mut list {
        if workspace.parent_id.as_deref() == Some(&id) {
            workspace.parent_id = parent.clone();
        }
    }
    list.retain(|workspace| workspace.id != id);
    normalize_workspace_orders(&mut list);
    write_workspaces(&app, &list)
}

#[tauri::command]
pub async fn rename_workspace<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    name: String,
) -> Result<Workspace, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Workspace name cannot be empty.".to_string());
    }
    let mut list = read_workspaces(&app)?;
    let workspace = list
        .iter_mut()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| format!("Unknown workspace \"{workspace_id}\""))?;
    workspace.name = name.to_string();
    let result = workspace.clone();
    write_workspaces(&app, &list)?;
    Ok(result)
}
