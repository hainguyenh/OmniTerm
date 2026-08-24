use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

#[cfg(test)]
#[path = "custom_art_tests.rs"]
mod tests;

pub fn custom_art_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(dir.join("custom-art"))
}

fn is_valid_slot(slot: &str) -> bool {
    matches!(
        slot,
        "idle-light" | "idle-dark" | "loading-light" | "loading-dark"
    )
}

fn has_valid_extension(path: &Path) -> bool {
    if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
        let ext = ext.to_lowercase();
        matches!(
            ext.as_str(),
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"
        )
    } else {
        false
    }
}

pub fn upload_custom_art_impl(dir: &Path, slot: &str, path: &Path) -> Result<String, String> {
    if !is_valid_slot(slot) {
        return Err("Invalid slot name".into());
    }

    if !path.exists() {
        return Err("File does not exist".into());
    }
    if !path.is_file() {
        return Err("Path is not a file".into());
    }

    if !has_valid_extension(path) {
        return Err("Invalid file extension".into());
    }

    let meta = fs::metadata(path).map_err(|e| format!("Failed to read metadata: {e}"))?;
    if meta.len() > 2 * 1024 * 1024 {
        return Err("File exceeds 2 MB limit".into());
    }

    if !dir.exists() {
        fs::create_dir_all(dir).map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    // Remove any existing file for this slot
    let _ = remove_custom_art_impl(dir, slot);

    let ext = path.extension().unwrap().to_str().unwrap();
    let dest = dir.join(format!("{}.{}", slot, ext));

    fs::copy(path, &dest).map_err(|e| format!("Failed to copy file: {e}"))?;

    dest.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to convert path to string".into())
}

pub fn get_custom_art_impl(dir: &Path, slot: &str) -> Result<Option<String>, String> {
    if !is_valid_slot(slot) {
        return Err("Invalid slot name".into());
    }

    if !dir.exists() {
        return Ok(None);
    }

    for entry in fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {e}"))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
        let path = entry.path();

        if path.is_file() {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if stem == slot {
                    return path
                        .to_str()
                        .map(|s| Some(s.to_string()))
                        .ok_or_else(|| "Failed to convert path to string".into());
                }
            }
        }
    }

    Ok(None)
}

pub fn remove_custom_art_impl(dir: &Path, slot: &str) -> Result<(), String> {
    if !is_valid_slot(slot) {
        return Err("Invalid slot name".into());
    }

    if !dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {e}"))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
        let path = entry.path();

        if path.is_file() {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if stem == slot {
                    fs::remove_file(&path).map_err(|e| format!("Failed to remove file: {e}"))?;
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn upload_custom_art<R: Runtime>(
    app: AppHandle<R>,
    slot: String,
    path: String,
) -> Result<String, String> {
    let dir = custom_art_dir(&app)?;
    upload_custom_art_impl(&dir, &slot, Path::new(&path))
}

#[tauri::command]
pub async fn get_custom_art<R: Runtime>(
    app: AppHandle<R>,
    slot: String,
) -> Result<Option<String>, String> {
    let dir = custom_art_dir(&app)?;
    get_custom_art_impl(&dir, &slot)
}

#[tauri::command]
pub async fn remove_custom_art<R: Runtime>(app: AppHandle<R>, slot: String) -> Result<(), String> {
    let dir = custom_art_dir(&app)?;
    remove_custom_art_impl(&dir, &slot)
}
