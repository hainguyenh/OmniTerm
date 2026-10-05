//! Tauri commands for managing temporary notes stored in the application's `_temp` directory.

use std::fs;
use std::path::{Path, PathBuf};

use app_core::temp_notes::{self, validate_note_id};
use app_protocol::temp_note::TempNoteMeta;
use tauri::{AppHandle, Manager, Runtime};

fn temp_notes_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let temp_dir = app_dir.join("_temp");
    if !temp_dir.exists() {
        fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    }
    Ok(temp_dir)
}

#[tauri::command]
pub async fn list_temp_notes<R: Runtime>(app: AppHandle<R>) -> Result<Vec<TempNoteMeta>, String> {
    let temp_dir = temp_notes_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || temp_notes::list_temp_notes(&temp_dir))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn read_temp_note<R: Runtime>(app: AppHandle<R>, id: String) -> Result<String, String> {
    let temp_dir = temp_notes_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || temp_notes::read_temp_note(&temp_dir, &id))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn write_temp_note<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    content: String,
) -> Result<TempNoteMeta, String> {
    let temp_dir = temp_notes_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        temp_notes::write_temp_note(&temp_dir, &id, &content)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn delete_temp_note<R: Runtime>(app: AppHandle<R>, id: String) -> Result<bool, String> {
    let temp_dir = temp_notes_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        temp_notes::delete_temp_note(&temp_dir, &id)?;
        Ok(true)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn save_temp_note_as<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    suggested_name: Option<String>,
) -> Result<Option<String>, String> {
    validate_note_id(&id)?;
    let temp_dir = temp_notes_dir(&app)?;
    let content = temp_notes::read_temp_note(&temp_dir, &id)?;

    let name = suggested_name.unwrap_or_else(|| "note.txt".to_string());
    let mut dialog = rfd::AsyncFileDialog::new().set_file_name(&name);
    if let Some(ext) = Path::new(&name).extension().and_then(|e| e.to_str()) {
        dialog = dialog.add_filter(ext, &[ext]);
    }

    let Some(handle) = dialog.save_file().await else {
        return Ok(None);
    };

    let target_path = handle.path().to_path_buf();
    fs::write(&target_path, &content).map_err(|e| e.to_string())?;

    let _ = temp_notes::delete_temp_note(&temp_dir, &id);

    Ok(Some(target_path.to_string_lossy().into_owned()))
}
