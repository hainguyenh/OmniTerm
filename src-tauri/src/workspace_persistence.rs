use app_core::workspace_model::{decode_workspaces, validate_workspace_list};
use app_protocol::workspace::Workspace;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

pub(crate) fn workspaces_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|error| error.to_string())?;
    }
    Ok(app_dir.join("workspaces.json"))
}

pub(crate) fn read_workspaces<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<Workspace>, String> {
    let path = workspaces_file(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let decoded = decode_workspaces(&content)?;
    if decoded.migrated {
        write_workspaces(app, &decoded.workspaces)?;
    }
    Ok(decoded.workspaces)
}

pub(crate) fn write_workspaces<R: Runtime>(
    app: &AppHandle<R>,
    list: &[Workspace],
) -> Result<(), String> {
    validate_workspace_list(list)?;
    let path = workspaces_file(app)?;
    let content = serde_json::to_string_pretty(list).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}
