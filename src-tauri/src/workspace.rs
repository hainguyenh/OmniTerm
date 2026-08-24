//! Saved workspace containers and folder-scoped filesystem commands.
//!
//! A workspace is not itself a filesystem root. It owns one or more real folder roots, while every
//! renderer-visible path is namespaced as `<folderId>/<relativePath>` so scans from different roots
//! cannot collide.

use crate::adhoc;
use crate::openshell::OpenShellRequest;
use crate::safepath;
use crate::workspace_folders::{canonical_dir, new_folder};
use crate::workspace_launch::{default_shell, script_run_request};
use crate::workspace_scan::{WorkspaceEntry, WorkspaceEntryPage, WorkspaceScript};
use app_core::workspace_model::{
    logical_target, move_workspace as move_workspace_model, namespace_path, set_entry_pinned,
};
pub use app_protocol::workspace::{Workspace, WorkspaceFolder, WorkspacePin};
use std::path::Path;
use tauri::{AppHandle, Manager, Runtime};
use uuid::Uuid;

#[cfg(test)]
#[cfg(test)]
pub(crate) use crate::workspace_lifecycle::{
    import_workspace_file, remove_workspace, rename_workspace,
};
#[cfg(test)]
pub(crate) use crate::workspace_persistence::workspaces_file;
pub(crate) use crate::workspace_persistence::{read_workspaces, write_workspaces};
#[cfg(test)]
#[path = "workspace_tests.rs"]
mod tests;
#[cfg(test)]
#[path = "workspace_command_validation_tests.rs"]
mod command_validation_tests;

fn display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| path.to_string())
}

pub(crate) fn next_root_order(list: &[Workspace]) -> usize {
    list.iter()
        .filter(|workspace| workspace.parent_id.is_none())
        .map(|workspace| workspace.order)
        .max()
        .map_or(0, |order| order.saturating_add(1))
}

pub(crate) fn new_workspace(
    name: String,
    folders: Vec<WorkspaceFolder>,
    order: usize,
) -> Workspace {
    Workspace {
        id: format!("ws#{}", Uuid::new_v4()),
        name,
        folders,
        parent_id: None,
        order,
        pins: Vec::new(),
        color: None,
        icon: None,
    }
}

pub(crate) fn find_workspace<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
) -> Result<Workspace, String> {
    read_workspaces(app)?
        .into_iter()
        .find(|workspace| workspace.id == id)
        .ok_or_else(|| format!("Unknown workspace \"{id}\""))
}
#[tauri::command]
pub async fn list_workspaces<R: Runtime>(app: AppHandle<R>) -> Result<Vec<Workspace>, String> {
    read_workspaces(&app)
}

#[tauri::command]
pub async fn create_workspace<R: Runtime>(
    app: AppHandle<R>,
    name: String,
) -> Result<Workspace, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Workspace name cannot be empty.".to_string());
    }
    let mut list = read_workspaces(&app)?;
    let workspace = new_workspace(name.to_string(), Vec::new(), next_root_order(&list));
    list.push(workspace.clone());
    write_workspaces(&app, &list)?;
    Ok(workspace)
}

/// Backward-compatible one-folder add: creates a new container around the selected folder.
#[tauri::command]
pub async fn add_workspace<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<Workspace, String> {
    let path = canonical_dir(&path)?;
    let mut list = read_workspaces(&app)?;
    if let Some(existing) = list
        .iter()
        .find(|workspace| workspace.folders.iter().any(|folder| folder.path == path))
    {
        return Ok(existing.clone());
    }
    let name = display_name(&path);
    let workspace = new_workspace(
        name.clone(),
        vec![new_folder(path, Some(name))],
        next_root_order(&list),
    );
    list.push(workspace.clone());
    write_workspaces(&app, &list)?;
    Ok(workspace)
}

#[tauri::command]
pub async fn move_workspace<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    parent_id: Option<String>,
    index: usize,
) -> Result<Vec<Workspace>, String> {
    let mut list = read_workspaces(&app)?;
    move_workspace_model(&mut list, &workspace_id, parent_id.as_deref(), index)?;
    write_workspaces(&app, &list)?;
    Ok(list)
}

#[tauri::command]
pub async fn set_workspace_entry_pinned<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    folder_id: String,
    path: String,
    pinned: bool,
) -> Result<Workspace, String> {
    let mut list = read_workspaces(&app)?;
    let workspace = list
        .iter_mut()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| format!("Unknown workspace \"{workspace_id}\""))?;
    set_entry_pinned(workspace, &folder_id, &path, pinned)?;
    let result = workspace.clone();
    write_workspaces(&app, &list)?;
    Ok(result)
}

fn namespace_entry(folder_id: &str, mut entry: WorkspaceEntry) -> WorkspaceEntry {
    entry.id = namespace_path(folder_id, &entry.id);
    entry.path = entry.id.clone();
    entry
}

fn namespace_script(folder_id: &str, mut script: WorkspaceScript) -> WorkspaceScript {
    script.id = namespace_path(folder_id, &script.id);
    script.path = script.id.clone();
    script
}

#[tauri::command]
pub async fn scan_scripts<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
) -> Result<Vec<WorkspaceScript>, String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    let mut scripts = Vec::new();
    for folder in &workspace.folders {
        let root = Path::new(&folder.path);
        if root.is_dir() {
            scripts.extend(
                crate::workspace_scan::scan_dir_excluding(root, &excluded_viewable_exts(&app))
                    .into_iter()
                    .map(|script| namespace_script(&folder.id, script)),
            );
        }
    }
    Ok(scripts)
}

#[tauri::command]
pub async fn scan_workspace_folders<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
) -> Result<Vec<WorkspaceEntry>, String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    let mut entries = Vec::new();
    for folder in &workspace.folders {
        entries.push(WorkspaceEntry {
            id: folder.id.clone(),
            name: folder.name.clone(),
            path: folder.id.clone(),
            is_dir: true,
            kind: "dir".to_string(),
            shell: None,
            editable: None,
            viewable: None,
        });
        let root = Path::new(&folder.path);
        if root.is_dir() {
            entries.extend(
                crate::workspace_scan::scan_folders(root)
                    .into_iter()
                    .map(|entry| namespace_entry(&folder.id, entry)),
            );
        }
    }
    Ok(entries)
}

#[tauri::command]
pub async fn scan_workspace_entries<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    folder: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<WorkspaceEntryPage, String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    if folder.trim().is_empty() {
        return Ok(WorkspaceEntryPage {
            entries: Vec::new(),
            total: 0,
            has_more: false,
        });
    }
    let target = logical_target(&workspace, &folder)?;
    let root = Path::new(&target.folder.path);
    if !root.is_dir() {
        return Err(format!(
            "Workspace folder \"{}\" is unavailable.",
            target.folder.name
        ));
    }
    let page = crate::workspace_scan::scan_folder_files_excluding(
        root,
        &target.relative_path,
        &excluded_viewable_exts(&app),
        offset.unwrap_or(0),
        limit
            .unwrap_or(crate::workspace_scan::DEFAULT_PAGE_SIZE)
            .min(crate::workspace_scan::MAX_PAGE_SIZE),
    )?;
    Ok(WorkspaceEntryPage {
        entries: page
            .entries
            .into_iter()
            .map(|entry| namespace_entry(&target.folder.id, entry))
            .collect(),
        total: page.total,
        has_more: page.has_more,
    })
}

#[tauri::command]
pub async fn run_script<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    script: Option<WorkspaceScript>,
    sub_path: Option<String>,
) -> Result<bool, String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    if let Some(script) = script.filter(|script| !script.path.is_empty()) {
        let target = logical_target(&workspace, &script.path)?;
        let real = safepath::safe_runnable_path(&target.folder.path, &target.relative_path)?;
        let real = real.to_string_lossy().into_owned();
        if script.kind == "rdp" {
            app.state::<crate::os_actions::ExternalLauncherState>()
                .launch_rdp(&real)?;
            return Ok(true);
        }
        let request = script_run_request(&script.kind, &real, &script.name, &target.folder.path);
        adhoc::open_adhoc_shell(&app, request);
        return Ok(true);
    }
    let logical = sub_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Choose a workspace folder before opening a terminal.".to_string())?;
    let target = logical_target(&workspace, logical)?;
    let cwd = safepath::safe_subdir(&target.folder.path, &target.relative_path, false)?;
    let name = target
        .relative_path
        .split('/')
        .rfind(|value| !value.is_empty())
        .unwrap_or(&target.folder.name)
        .to_string();
    adhoc::open_adhoc_shell(
        &app,
        OpenShellRequest {
            shell: default_shell(),
            cwd: Some(cwd.to_string_lossy().into_owned()),
            command: None,
            args: None,
            keep_open: true,
            name,
        },
    );
    Ok(true)
}

fn max_open_bytes<R: Runtime>(app: &AppHandle<R>) -> u64 {
    let configured = crate::settings::read_settings(app)
        .get("maxOpenFileMb")
        .and_then(serde_json::Value::as_u64)
        .map(|mb| mb.saturating_mul(1024 * 1024));
    safepath::clamp_max_bytes(configured)
}

fn excluded_viewable_exts<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    crate::settings::read_settings(app)
        .get("excludedViewableExts")
        .and_then(serde_json::Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|value| value.as_str().map(str::to_lowercase))
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn read_script<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    path: String,
) -> Result<String, String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    let target = logical_target(&workspace, &path)?;
    safepath::read_viewable_excluding(
        &target.folder.path,
        &target.relative_path,
        max_open_bytes(&app),
        &excluded_viewable_exts(&app),
    )
}

#[tauri::command]
pub async fn write_script<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let workspace = find_workspace(&app, &workspace_id)?;
    let target = logical_target(&workspace, &path)?;
    safepath::write_editable(
        &target.folder.path,
        &target.relative_path,
        &content,
        max_open_bytes(&app),
    )
}
