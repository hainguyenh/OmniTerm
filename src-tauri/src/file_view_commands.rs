//! Tauri adapter for the editor tab's non-text views: the image viewer's bytes
//! (`app_core::image_file`) and where a workspace file sits in its Git repository.
//!
//! Both resolve a workspace-logical path to its folder first, exactly as the text editor's open does,
//! so neither can address a file outside the folders the user pinned.

use app_core::image_file;
use app_core::safepath;
use app_core::workspace_model::logical_target;
use app_protocol::git::GitFileContext;
use tauri::ipc::Response;
use tauri::{AppHandle, Runtime};

use crate::workspace::{excluded_viewable_exts, find_workspace};

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

/// The image's raw bytes, delivered to the renderer as an `ArrayBuffer` rather than a JSON number
/// array — a few megabytes of pixels would otherwise balloon several times over in transit.
#[tauri::command]
pub async fn open_image_file<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    path: String,
) -> Result<Response, String> {
    let bytes = blocking(move || {
        let workspace = find_workspace(&app, &workspace_id)?;
        let target = logical_target(&workspace, &path)?;
        image_file::read_image_file(
            &target.folder.path,
            &target.relative_path,
            &excluded_viewable_exts(&app),
        )
    })
    .await?;
    Ok(Response::new(bytes))
}

/// The repository root, repo-relative path and branch for a workspace file; an error when the file
/// is not inside a Git work tree, which the editor reads as "no Git actions here".
#[tauri::command]
pub async fn git_file_context<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    path: String,
) -> Result<GitFileContext, String> {
    blocking(move || {
        let workspace = find_workspace(&app, &workspace_id)?;
        let target = logical_target(&workspace, &path)?;
        let real = safepath::contained_path(&target.folder.path, &target.relative_path)?;
        app_core::git::file_context(&real)
    })
    .await
}
