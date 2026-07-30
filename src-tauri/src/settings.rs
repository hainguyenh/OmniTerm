//! App settings persistence.
//!
//! Ports electron/core/settings.ts + the `settings:get` / `settings:save` handlers.
//!
//! Settings are handled as raw JSON rather than a typed struct, for two reasons the first port ran
//! into by modeling them as one:
//!
//!   * The field names and defaults are a contract with the renderer. The struct invented
//!     `darkMode`, `checkUpdates` and a different set of shortcut keys, so a fresh install served a
//!     settings object in which nothing the UI reads (`themeId`, `smartColors`,
//!     `checkUpdatesOnStartup`, `shortcuts.lock`, …) existed.
//!   * `save` is a PARTIAL merge. The renderer and the updater each write a subset of fields; a
//!     typed round-trip fills every absent field with its default, so saving `{skippedVersion}`
//!     silently reset the user's theme and font size.

use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[cfg(test)]
#[path = "settings_tests.rs"]
mod tests;

/// Default keybindings. Must stay in step with `DEFAULT_SHORTCUTS` in electron/core/settings.ts.
pub fn default_shortcuts() -> Value {
    json!({
        "lock": "Ctrl+L",
        "zoomIn": "Ctrl+=",
        "zoomOut": "Ctrl+-",
        "newSession": "Ctrl+N",
        "newFolder": "Ctrl+Shift+N",
        "openSettings": "Ctrl+,",
        "toggleThemeMode": "Ctrl+/",
        "layout1": "Ctrl+1",
        "layout2": "Ctrl+2",
        "layout4": "Ctrl+4",
        "layout6": "Ctrl+6",
        "layout8": "Ctrl+8",
        "toggleSidebar": "Ctrl+B"
    })
}

/// Default settings. Must stay in step with `DEFAULTS` in electron/core/settings.ts.
pub fn defaults() -> Value {
    json!({
        "themeId": "tokyo-night",
        "fontSize": 14,
        "smartColors": true,
        "checkUpdatesOnStartup": true,
        "skippedVersion": null,
        // Cap on what the built-in viewer/editor will open or save, in whole MB. 1 MB covers every
        // script and config file this app manages; a user who wants to read a large log raises it.
        // `safepath::clamp_max_bytes` enforces the supported range at the point of use, so a
        // hand-edited or legacy value here cannot turn into an unbounded read.
        "maxOpenFileMb": 1,
        // Extensions the user has chosen to hide from the viewer, on top of the fixed
        // `safepath::VIEW_DENY_EXTS` gate (which this list can never widen — see GeneralSettings.tsx).
        "excludedViewableExts": [],
        "shortcuts": default_shortcuts(),
        "workspaces": [],
    })
}

/// Shallow merge of `patch` over `base`, matching JavaScript's `{ ...base, ...patch }`.
///
/// Shallow on purpose: the Electron store spreads one level, so writing a `shortcuts` object replaces
/// it wholesale rather than merging key by key. Deep-merging here would make it impossible to clear
/// a single binding.
pub fn merge_shallow(base: &Value, patch: &Value) -> Value {
    let mut out: Map<String, Value> = base.as_object().cloned().unwrap_or_default();
    if let Some(patch) = patch.as_object() {
        for (key, value) in patch {
            out.insert(key.clone(), value.clone());
        }
    }
    Value::Object(out)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(dir.join("settings.json"))
}

/// Read stored settings layered over the defaults. An unreadable or corrupt file yields the defaults
/// rather than an error — the same fallback the Electron store used. Losing a preference is
/// recoverable; refusing to start is not.
pub fn read_settings(app: &AppHandle) -> Value {
    let stored = settings_path(app)
        .ok()
        .filter(|p| p.exists())
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .filter(|v| v.is_object());

    match stored {
        Some(stored) => merge_shallow(&defaults(), &stored),
        None => defaults(),
    }
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<Value, String> {
    Ok(read_settings(&app))
}

/// Merge a partial settings object into what is stored.
#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    if !settings.is_object() {
        return Err("Settings must be an object.".to_string());
    }

    let merged = merge_shallow(&read_settings(&app), &settings);
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create settings directory: {e}"))?;
        }
    }
    let contents = serde_json::to_string_pretty(&merged)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    fs::write(&path, contents).map_err(|e| format!("Failed to write settings file: {e}"))
}
