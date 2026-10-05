//! Tauri adapter for the workspace tree's structural edits (`app_core::workspace_fs`).
//!
//! Paths arrive workspace-logical (`<folderId>/<relativePath>`) and leave the same way. Renaming,
//! moving or deleting a file carries its pin along, so a pinned file never leaves a dangling pin.

use app_core::workspace_fs;
use app_core::workspace_model::{logical_target, move_entry_pin, namespace_path, remove_entry_pin};
use app_protocol::workspace::Workspace;
use tauri::{AppHandle, Runtime};

use crate::text_file_commands::blocking;
use crate::workspace::{find_workspace, read_workspaces, write_workspaces};

/// Apply `change` to the stored workspace and persist it only when something changed.
fn update_workspace<R: Runtime>(
    app: &AppHandle<R>,
    workspace_id: &str,
    change: impl FnOnce(&mut Workspace) -> bool,
) -> Result<(), String> {
    let mut list = read_workspaces(app)?;
    let Some(workspace) = list.iter_mut().find(|item| item.id == workspace_id) else {
        return Ok(());
    };
    if change(workspace) {
        write_workspaces(app, &list)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn create_workspace_directory<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    path: String,
) -> Result<String, String> {
    blocking(move || {
        let workspace = find_workspace(&app, &workspace_id)?;
        let target = logical_target(&workspace, &path)?;
        let relative = workspace_fs::create_directory(&target.folder.path, &target.relative_path)?;
        Ok(namespace_path(&target.folder.id, &relative))
    })
    .await
}

/// Rename or move a file; `from` and `to` may sit in different folders of the same workspace.
#[tauri::command]
pub async fn move_workspace_file<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    from: String,
    to: String,
) -> Result<String, String> {
    blocking(move || {
        let workspace = find_workspace(&app, &workspace_id)?;
        let source = logical_target(&workspace, &from)?;
        let target = logical_target(&workspace, &to)?;
        let relative = workspace_fs::move_file(
            &source.folder.path,
            &source.relative_path,
            &target.folder.path,
            &target.relative_path,
        )?;
        update_workspace(&app, &workspace_id, |stored| {
            move_entry_pin(
                stored,
                &source.folder.id,
                &source.relative_path,
                &target.folder.id,
                &relative,
            )
        })
        .map_err(|error| {
            format!("The file was moved, but its pin could not be updated: {error}")
        })?;
        Ok(namespace_path(&target.folder.id, &relative))
    })
    .await
}

#[tauri::command]
pub async fn delete_workspace_file<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    path: String,
) -> Result<(), String> {
    blocking(move || {
        let workspace = find_workspace(&app, &workspace_id)?;
        let target = logical_target(&workspace, &path)?;
        workspace_fs::delete_file(&target.folder.path, &target.relative_path)?;
        update_workspace(&app, &workspace_id, |stored| {
            remove_entry_pin(stored, &target.folder.id, &target.relative_path)
        })
        .map_err(|error| format!("The file was deleted, but its pin could not be removed: {error}"))
    })
    .await
}
