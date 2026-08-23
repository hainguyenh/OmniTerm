//! Workspace folder commands: attach real directories to a workspace, unlink
//! them, and set their display alias. Paths and ids are immutable here — only
//! membership and the alias change.

use crate::workspace_persistence::{read_workspaces, write_workspaces};
use app_core::workspace_model::rename_folder;
pub use app_protocol::workspace::{Workspace, WorkspaceFolder};
use std::path::Path;
use tauri::{AppHandle, Runtime};
use uuid::Uuid;

pub(crate) fn canonical_dir(path: &str) -> Result<String, String> {
    let canonical = dunce::canonicalize(path).map_err(|_| "That path is not a folder.".to_string())?;
    if !canonical.is_dir() {
        return Err("That path is not a folder.".to_string());
    }
    Ok(canonical.to_string_lossy().into_owned())
}

pub(crate) fn new_folder(path: String, name: Option<String>) -> WorkspaceFolder {
    let display = name.filter(|value| !value.trim().is_empty()).unwrap_or_else(|| {
        Path::new(&path)
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or(path.clone())
    });
    WorkspaceFolder {
        id: format!("folder#{}", Uuid::new_v4()),
        name: display,
        path,
        color: None,
    }
}

#[tauri::command]
pub async fn add_workspace_folder<R: Runtime>(app: AppHandle<R>, workspace_id: String, path: String) -> Result<Workspace, String> {
    let path = canonical_dir(&path)?;
    let mut list = read_workspaces(&app)?;
    let workspace = list.iter_mut().find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| format!("Unknown workspace \"{workspace_id}\""))?;
    if !workspace.folders.iter().any(|folder| folder.path == path) {
        workspace.folders.push(new_folder(path, None));
    }
    let result = workspace.clone();
    write_workspaces(&app, &list)?;
    Ok(result)
}

#[tauri::command]
pub async fn remove_workspace_folder<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    folder_id: String,
) -> Result<Workspace, String> {
    let mut list = read_workspaces(&app)?;
    let workspace = list.iter_mut().find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| format!("Unknown workspace \"{workspace_id}\""))?;
    let original_len = workspace.folders.len();
    workspace.folders.retain(|folder| folder.id != folder_id);
    if workspace.folders.len() == original_len {
        return Err(format!("Unknown workspace folder \"{folder_id}\""));
    }
    workspace.pins.retain(|pin| pin.folder_id != folder_id);
    let result = workspace.clone();
    write_workspaces(&app, &list)?;
    Ok(result)
}

#[tauri::command]
pub async fn rename_workspace_folder<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    folder_id: String,
    name: String,
) -> Result<Workspace, String> {
    // The alias is display-only: the folder's path and id stay untouched, so
    // scans, pins and launches keep resolving to the same directory.
    let mut list = read_workspaces(&app)?;
    let workspace = list.iter_mut().find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| format!("Unknown workspace \"{workspace_id}\""))?;
    rename_folder(workspace, &folder_id, &name)?;
    let result = workspace.clone();
    write_workspaces(&app, &list)?;
    Ok(result)
}
