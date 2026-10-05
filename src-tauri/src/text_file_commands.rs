//! Tauri adapter for the built-in editor's open/save (`app_core::text_file`).
//!
//! Resolves a workspace-logical path to its folder and applies the user's open cap and excluded
//! extensions, exactly as `read_script` does. The file work runs on the blocking pool: a 25 MB read,
//! a fsync and a rename are not work for the async runtime's own threads.

use app_core::text_file;
use app_core::workspace_model::logical_target;
use app_protocol::text_file::{TextFileContent, TextFileSaveOutcome, TextFileSaveRequest};
use tauri::{AppHandle, Runtime};

use crate::workspace::{excluded_viewable_exts, find_workspace, max_open_bytes};

pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn open_text_file<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    path: String,
) -> Result<TextFileContent, String> {
    blocking(move || {
        let workspace = find_workspace(&app, &workspace_id)?;
        let target = logical_target(&workspace, &path)?;
        text_file::open_text_file(
            &target.folder.path,
            &target.relative_path,
            max_open_bytes(&app),
            &excluded_viewable_exts(&app),
        )
    })
    .await
}

#[tauri::command]
pub async fn save_text_file<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    path: String,
    request: TextFileSaveRequest,
) -> Result<TextFileSaveOutcome, String> {
    blocking(move || {
        let workspace = find_workspace(&app, &workspace_id)?;
        let target = logical_target(&workspace, &path)?;
        text_file::save_text_file(
            &target.folder.path,
            &target.relative_path,
            &request,
            max_open_bytes(&app),
            &excluded_viewable_exts(&app),
        )
    })
    .await
}

#[tauri::command]
pub async fn create_text_file<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    path: String,
) -> Result<String, String> {
    blocking(move || {
        let workspace = find_workspace(&app, &workspace_id)?;
        let target = logical_target(&workspace, &path)?;
        let rel = text_file::create_text_file(
            &target.folder.path,
            &target.relative_path,
            &excluded_viewable_exts(&app),
        )?;
        Ok(format!("{}/{}", target.folder.id, rel))
    })
    .await
}
