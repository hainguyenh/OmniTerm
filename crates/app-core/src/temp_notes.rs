//! Operations for temporary notes stored in the application's `_temp` directory.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use app_protocol::temp_note::TempNoteMeta;

#[cfg(test)]
#[path = "temp_notes_tests.rs"]
mod tests;

/// Validate that a note ID is safe and contains no path separators or traversal.
pub fn validate_note_id(id: &str) -> Result<(), String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err("Note ID cannot be empty".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Note ID contains invalid characters".to_string());
    }
    Ok(())
}

fn note_path(temp_dir: &Path, id: &str) -> Result<PathBuf, String> {
    validate_note_id(id)?;
    Ok(temp_dir.join(format!("{id}.txt")))
}

fn extract_title(content: &str) -> String {
    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            let mut title = trimmed.chars().take(40).collect::<String>();
            if trimmed.chars().count() > 40 {
                title.push('…');
            }
            return title;
        }
    }
    "Untitled Note".to_string()
}

fn mtime_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// List all temporary notes in `temp_dir`, sorted newest first.
pub fn list_temp_notes(temp_dir: &Path) -> Result<Vec<TempNoteMeta>, String> {
    if !temp_dir.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(temp_dir).map_err(|e| e.to_string())?;
    let mut notes = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("txt") {
            let id = match path.file_stem().and_then(|s| s.to_str()) {
                Some(stem) if validate_note_id(stem).is_ok() => stem.to_string(),
                _ => continue,
            };
            let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
            let content = fs::read_to_string(&path).unwrap_or_default();
            let title = extract_title(&content);
            notes.push(TempNoteMeta {
                id,
                title,
                mtime_ms: mtime_ms(&metadata),
                size: metadata.len(),
            });
        }
    }

    notes.sort_by_key(|a| std::cmp::Reverse(a.mtime_ms));
    Ok(notes)
}

/// Read the full content of note `id`.
pub fn read_temp_note(temp_dir: &Path, id: &str) -> Result<String, String> {
    let path = note_path(temp_dir, id)?;
    if !path.exists() {
        return Err(format!("Temp note '{id}' not found"));
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write or overwrite note `id` with `content`.
pub fn write_temp_note(temp_dir: &Path, id: &str, content: &str) -> Result<TempNoteMeta, String> {
    let path = note_path(temp_dir, id)?;
    if !temp_dir.exists() {
        fs::create_dir_all(temp_dir).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())?;
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(TempNoteMeta {
        id: id.to_string(),
        title: extract_title(content),
        mtime_ms: mtime_ms(&metadata),
        size: metadata.len(),
    })
}

/// Delete note `id` if it exists.
pub fn delete_temp_note(temp_dir: &Path, id: &str) -> Result<(), String> {
    let path = note_path(temp_dir, id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
