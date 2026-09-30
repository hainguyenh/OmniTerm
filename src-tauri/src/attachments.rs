//! Desktop adapter for the attachment folder (`app_core::attachments`): images and files pasted or
//! dropped into an AI agent pane, stored under the app's local data dir so the user can review and
//! clear them (Settings → General → Attachments, and the pane footer's paperclip).
//!
//! The renderer never names a directory or a source path. It sends bytes plus a name hint, or asks
//! this side to import whatever files Explorer put on the clipboard.

use app_core::attachments::{self, AttachmentInfo, ClearReport};
use serde::Serialize;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, Runtime};

#[cfg(test)]
#[path = "attachments_tests.rs"]
mod tests;

#[cfg(windows)]
#[path = "attachments_clipboard_windows.rs"]
mod clipboard_files;

/// Header carrying the `encodeURIComponent`-encoded original file name of a raw-body upload.
const NAME_HEADER: &str = "x-omniterm-attachment-name";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentListing {
    dir: String,
    /// The folder's files, newest first, then pasted images left in the OS temp dir by older builds.
    files: Vec<AttachmentInfo>,
}

fn attachments_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map(|dir| dir.join("attachments"))
        .map_err(|error| format!("Failed to get app data dir: {error}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create attachments dir: {error}"))?;
    Ok(dir)
}

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

async fn blocking<T: Send + 'static>(
    what: &str,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("{what} failed: {error}"))
}

/// Persist pasted clipboard-image bytes as a PNG attachment and return its absolute path, so a
/// terminal agent can attach it by path. Same contract as before; only the folder changed.
#[tauri::command]
pub async fn save_temp_image<R: Runtime>(
    app: AppHandle<R>,
    bytes: Vec<u8>,
) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("Clipboard image payload is empty.".to_string());
    }
    let dir = attachments_dir(&app)?;
    blocking("Saving the pasted image", move || {
        attachments::save_attachment(&dir, "paste.png", &bytes, stamp())
    })
    .await?
    .map(|info| info.path)
    .map_err(|error| format!("Could not write pasted image: {error}"))
}

/// Save one dropped/pasted file. The bytes arrive as the raw IPC body (no JSON number array for a
/// multi-megabyte file); the original name rides in [`NAME_HEADER`] and is only a hint.
#[tauri::command]
pub async fn save_attachment<R: Runtime>(
    app: AppHandle<R>,
    request: Request<'_>,
) -> Result<AttachmentInfo, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Attachment bytes must be sent as a raw body.".to_string());
    };
    let bytes = bytes.clone();
    let hint = request
        .headers()
        .get(NAME_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(attachments::percent_decode)
        .unwrap_or_default();
    let dir = attachments_dir(&app)?;
    blocking("Saving the attachment", move || {
        attachments::save_attachment(&dir, &hint, &bytes, stamp())
    })
    .await?
    .map_err(|error| format!("Could not save the attachment: {error}"))
}

/// Copy the files Explorer put on the clipboard (Copy on a file) into the folder. Empty when the
/// clipboard holds no files, or off Windows. Folders and oversized files are skipped.
#[tauri::command]
pub async fn import_clipboard_files<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<AttachmentInfo>, String> {
    let dir = attachments_dir(&app)?;
    blocking("Reading copied files", move || {
        let stamp = stamp();
        clipboard_file_paths()
            .iter()
            .filter_map(|source| attachments::import_attachment(&dir, source, stamp).ok())
            .collect()
    })
    .await
}

#[cfg(windows)]
fn clipboard_file_paths() -> Vec<PathBuf> {
    clipboard_files::read().unwrap_or_default()
}

#[cfg(not(windows))]
fn clipboard_file_paths() -> Vec<PathBuf> {
    Vec::new()
}

#[tauri::command]
pub async fn list_attachments<R: Runtime>(app: AppHandle<R>) -> Result<AttachmentListing, String> {
    let dir = attachments_dir(&app)?;
    blocking("Listing attachments", move || {
        let mut files = attachments::list_attachments(&dir);
        files.extend(attachments::legacy_pastes(&std::env::temp_dir()));
        AttachmentListing {
            dir: dir.to_string_lossy().into_owned(),
            files,
        }
    })
    .await
}

/// Delete every stored attachment, plus pasted images older builds left in the OS temp dir.
#[tauri::command]
pub async fn clear_attachments<R: Runtime>(app: AppHandle<R>) -> Result<ClearReport, String> {
    let dir = attachments_dir(&app)?;
    blocking("Clearing attachments", move || {
        attachments::clear_attachments(&dir, Some(&std::env::temp_dir()))
    })
    .await
}
