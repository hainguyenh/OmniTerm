//! Workspace view: the pinned project folder list, and running what the scan found in one.
//!
//! The scan itself lives in `workspace_scan`.
//!
//! Ports electron/core/workspaceHost.ts.

use crate::adhoc;
use crate::openshell::OpenShellRequest;
use crate::rdp_launch;
use crate::safepath;
use crate::workspace_launch::{default_shell, script_run_request};
use crate::workspace_scan::{scan_dir, scan_entries, WorkspaceEntry, WorkspaceScript};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};
use uuid::Uuid;

#[cfg(test)]
#[path = "workspace_tests.rs"]
mod tests;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub pinned: Option<bool>,
}

// ── Persistence ──────────────────────────────────────────────────────────────

fn workspaces_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }
    Ok(app_dir.join("workspaces.json"))
}

/// Generic over the runtime so `workspace_connections::find_by_id` can scan workspaces while
/// `pty_resolve` (itself generic) is resolving a connection for launch.
pub(crate) fn read_workspaces<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<Workspace>, String> {
    let path = workspaces_file(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&content).map_err(|e| format!("workspaces.json is corrupt ({e})."))
}

fn write_workspaces(app: &AppHandle, list: &[Workspace]) -> Result<(), String> {
    let path = workspaces_file(app)?;
    let content = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_workspaces(app: AppHandle) -> Result<Vec<Workspace>, String> {
    read_workspaces(&app)
}

/// Pin a folder. Ports Electron's `addWorkspace`: re-pinning an existing folder is idempotent and
/// returns the entry already stored, rather than appending a duplicate with a new id.
#[tauri::command]
pub async fn add_workspace(app: AppHandle, path: String) -> Result<Workspace, String> {
    if !Path::new(&path).is_dir() {
        return Err("That path is not a folder.".to_string());
    }

    let mut list = read_workspaces(&app)?;
    if let Some(existing) = list.iter().find(|w| w.path == path) {
        return Ok(existing.clone());
    }

    let name = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| path.clone());

    // The `ws#` prefix matches the id format the renderer and the Electron provider both use.
    let workspace = Workspace {
        id: format!("ws#{}", Uuid::new_v4()),
        name,
        path,
        pinned: Some(true),
    };
    list.push(workspace.clone());
    write_workspaces(&app, &list)?;
    Ok(workspace)
}

#[tauri::command]
pub async fn remove_workspace(app: AppHandle, id: String) -> Result<(), String> {
    let mut list = read_workspaces(&app)?;
    list.retain(|w| w.id != id);
    write_workspaces(&app, &list)
}

pub(crate) fn find_workspace<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<Workspace, String> {
    read_workspaces(app)?
        .into_iter()
        .find(|w| w.id == id)
        .ok_or_else(|| format!("Unknown workspace \"{id}\""))
}

#[tauri::command]
pub async fn scan_scripts(
    app: AppHandle,
    workspace_id: String,
) -> Result<Vec<WorkspaceScript>, String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    let path = Path::new(&workspace.path);
    if !path.is_dir() {
        return Err("Workspace path is invalid".to_string());
    }
    Ok(scan_dir(path))
}

/// Everything in a workspace — folders included — for the Workspace panel's tree.
#[tauri::command]
pub async fn scan_workspace_entries(
    app: AppHandle,
    workspace_id: String,
) -> Result<Vec<WorkspaceEntry>, String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    let path = Path::new(&workspace.path);
    if !path.is_dir() {
        return Err("Workspace path is invalid".to_string());
    }
    Ok(scan_entries(path))
}

/// Run a script, or open a plain terminal in the workspace (or a scanned subfolder).
#[tauri::command]
pub async fn run_script(
    app: AppHandle,
    workspace_id: String,
    script: Option<WorkspaceScript>,
    sub_path: Option<String>,
) -> Result<bool, String> {
    let workspace = find_workspace(&app, &workspace_id)?;

    match script {
        Some(script) if !script.path.is_empty() => {
            // Containment check before anything is spawned: the path is supposed to have come from
            // our own scan of this workspace.
            let real = safepath::safe_runnable_path(&workspace.path, &script.path)?;
            let real = real.to_string_lossy().into_owned();

            if script.kind == "rdp" {
                // Not a script: the OS Remote Desktop client owns its own window, so there is no
                // pane to open and nothing to emit to the renderer.
                rdp_launch::launch_rdp(&real)?;
                return Ok(true);
            }
            let request = script_run_request(&script.kind, &real, &script.name, &workspace.path);
            adhoc::open_adhoc_shell(&app, request);
        }
        _ => {
            let (cwd, name) = match sub_path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                Some(sub) => {
                    let dir = safepath::safe_subdir(&workspace.path, sub)?;
                    let leaf = sub
                        .split('/').rfind(|s| !s.is_empty())
                        .unwrap_or(&workspace.name)
                        .to_string();
                    (dir.to_string_lossy().into_owned(), leaf)
                }
                None => (workspace.path.clone(), workspace.name.clone()),
            };
            adhoc::open_adhoc_shell(
                &app,
                OpenShellRequest {
                    shell: default_shell(),
                    cwd: Some(cwd),
                    command: None,
                    args: None,
                    keep_open: true,
                    name,
                },
            );
        }
    }

    Ok(true)
}

#[tauri::command]
pub async fn read_script(
    app: AppHandle,
    workspace_id: String,
    path: String,
) -> Result<String, String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    safepath::read_editable(&workspace.path, &path)
}

#[tauri::command]
pub async fn write_script(
    app: AppHandle,
    workspace_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    safepath::write_editable(&workspace.path, &path, &content)
}

// Workspace-scoped connection profiles live in workspace_connections.rs — this file was already over
// the per-file line limit, and the file format, its two commands, and the by-id lookup that makes a
// workspace connection launchable are one concern.
