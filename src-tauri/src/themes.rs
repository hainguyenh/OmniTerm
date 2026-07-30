use std::fs;
use tauri::{AppHandle, Manager};

fn get_themes_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let themes_dir = data_dir.join("themes");

    if !themes_dir.exists() {
        fs::create_dir_all(&themes_dir)
            .map_err(|e| format!("Failed to create themes directory: {}", e))?;
    }

    Ok(themes_dir)
}

#[tauri::command]
pub async fn list_themes(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let mut themes = Vec::new();

    // 1. Read built-in themes
    if let Ok(resource_dir) = app.path().resource_dir() {
        let builtin_dir = resource_dir.join("builtinThemes");
        if builtin_dir.exists() {
            if let Ok(entries) = fs::read_dir(&builtin_dir) {
                for entry in entries.flatten() {
                    if entry.path().extension().is_some_and(|ext| ext == "json") {
                        if let Ok(contents) = fs::read_to_string(entry.path()) {
                            if let Ok(theme) = serde_json::from_str::<serde_json::Value>(&contents) {
                                themes.push(theme);
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Read user themes
    let themes_dir = get_themes_dir(&app)?;
    if let Ok(entries) = fs::read_dir(&themes_dir) {
        for entry in entries.flatten() {
            if entry.path().extension().is_some_and(|ext| ext == "json") {
                if let Ok(contents) = fs::read_to_string(entry.path()) {
                    if let Ok(theme) = serde_json::from_str::<serde_json::Value>(&contents) {
                        themes.push(theme);
                    }
                }
            }
        }
    }

    Ok(themes)
}

/// Max length of a theme id, so a filename cannot be pushed past the OS limit.
const MAX_THEME_ID: usize = 64;

/// Validate a theme id that is about to become a filename.
///
/// A theme id arrives from the webview and is interpolated straight into `<themesDir>/<id>.json`, so
/// without this `save_theme`/`delete_theme` will happily write or delete any `.json` file on disk —
/// `{"id": "../../../../Users/me/AppData/Roaming/OmniTerm/connections"}` overwrites the connection
/// vault. Restricted to a conservative charset rather than filtered for `..`, so no separator,
/// drive prefix, or reserved character can get through.
pub fn validate_theme_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > MAX_THEME_ID {
        return Err(format!(
            "Theme id must be 1-{MAX_THEME_ID} characters long."
        ));
    }
    // A leading dot would make the file hidden and allows the `..` and `.` special names.
    if id.starts_with('.') {
        return Err("Theme id may not start with a dot.".to_string());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(
            "Theme id may only contain letters, digits, '-', '_' and '.'.".to_string(),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn save_theme(app: tauri::AppHandle, theme: serde_json::Value) -> Result<(), String> {
    let themes_dir = get_themes_dir(&app)?;

    let id = theme
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Theme object missing string 'id' field".to_string())?;
    validate_theme_id(id)?;

    let theme_path = themes_dir.join(format!("{id}.json"));

    let contents = serde_json::to_string_pretty(&theme)
        .map_err(|e| format!("Failed to serialize theme: {e}"))?;

    fs::write(&theme_path, contents).map_err(|e| format!("Failed to write theme file: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn delete_theme(app: tauri::AppHandle, id: String) -> Result<(), String> {
    validate_theme_id(&id)?;
    let themes_dir = get_themes_dir(&app)?;
    let theme_path = themes_dir.join(format!("{id}.json"));

    if theme_path.exists() {
        fs::remove_file(&theme_path).map_err(|e| format!("Failed to delete theme file: {e}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_ids_the_built_in_themes_use() {
        for id in ["tokyo-night", "tokyo_hot", "claude", "voltAgent", "theme.v2", "a"] {
            assert!(validate_theme_id(id).is_ok(), "{id} should be accepted");
        }
    }

    /// The traversal this closes: `<themesDir>/<id>.json` with a crafted id writes or deletes an
    /// arbitrary `.json` file — including the connection vault next door in the same app-data folder.
    #[test]
    fn rejects_ids_that_would_escape_the_themes_folder() {
        for hostile in [
            "../evil",
            "../../../../Users/me/AppData/Roaming/OmniTerm/connections",
            "..",
            ".",
            "..\\evil",
            "sub/theme",
            "sub\\theme",
            "C:/evil",
            "C:\\evil",
            r"\\server\share\evil",
            "/etc/passwd",
            ".hidden",
            "theme\0null",
            "theme:stream",
            "theme*glob",
            "",
        ] {
            assert!(
                validate_theme_id(hostile).is_err(),
                "{hostile:?} must be rejected"
            );
        }
    }

    #[test]
    fn rejects_an_over_long_id() {
        assert!(validate_theme_id(&"a".repeat(MAX_THEME_ID)).is_ok());
        assert!(validate_theme_id(&"a".repeat(MAX_THEME_ID + 1)).is_err());
    }
}

#[tauri::command]
pub async fn open_themes_folder(app: tauri::AppHandle) -> Result<(), String> {
    let themes_dir = get_themes_dir(&app)?;

    // Try opening using opener crate
    if let Err(e) = opener::open(&themes_dir) {
        // Fallback for missing opener or failure
        #[cfg(target_os = "windows")]
        std::process::Command::new("explorer").arg(&themes_dir).spawn().map_err(|e| e.to_string())?;

        #[cfg(target_os = "macos")]
        std::process::Command::new("open").arg(&themes_dir).spawn().map_err(|e| e.to_string())?;

        #[cfg(target_os = "linux")]
        std::process::Command::new("xdg-open").arg(&themes_dir).spawn().map_err(|e| e.to_string())?;
        
        let _ = e;
    }

    Ok(())
}
