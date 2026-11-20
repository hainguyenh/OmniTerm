//! The commands behind Settings › Agent Quota › status line bridges: whether a Claude profile runs
//! OmniTerm as its status line and sub-agent guard, or an Antigravity profile as its status line,
//! and installing or removing that. Thin: the logic lives in `app_core::agent_quota`
//! (`claude_bridge_install`, `agy_bridge_install`).
//!
//! The installed commands name this executable, so they keep working only while it stays where it
//! is; the status says when a profile points at another copy (an older install or a dev build).
//!
//! Also reads back the status line text the Claude bridge keeps per conversation (pane footer).

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use app_core::agent_quota::{
    agy_bridge_status, bridge_profile_dir, bridge_status, install_agy_bridge, install_bridge,
    read_statusline, remove_agy_bridge, remove_bridge, BridgeStatus, Platform, StatuslineRecord,
};
use app_core::builtin_features::AGENT_QUOTA;
use tauri::{AppHandle, Manager, Runtime};

fn ensure_enabled<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if crate::builtin_features::is_enabled(app, AGENT_QUOTA) {
        Ok(())
    } else {
        Err("Agent Quota is turned off in Plugins.".to_string())
    }
}

fn profile(value: &str) -> Result<PathBuf, String> {
    bridge_profile_dir(value).ok_or_else(|| "Invalid profile folder".to_string())
}

pub(super) fn exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|error| format!("Cannot locate OmniTerm: {error}"))
}

/// The settings file the guard reads its limits from.
pub(super) fn app_settings<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("settings.json"))
        .map_err(|error| format!("Failed to get app data dir: {error}"))
}

fn status(dir: &Path) -> Result<BridgeStatus, String> {
    Ok(bridge_status(dir, &exe()?, Platform::CURRENT))
}

#[tauri::command]
pub async fn agent_quota_claude_bridge_status<R: Runtime>(
    app: AppHandle<R>,
    profile_dir: String,
) -> Result<BridgeStatus, String> {
    ensure_enabled(&app)?;
    status(&profile(&profile_dir)?)
}

#[tauri::command]
pub async fn agent_quota_claude_bridge_install<R: Runtime>(
    app: AppHandle<R>,
    profile_dir: String,
) -> Result<BridgeStatus, String> {
    ensure_enabled(&app)?;
    let dir = profile(&profile_dir)?;
    install_bridge(&dir, &exe()?, &app_settings(&app)?, Platform::CURRENT)
        .map_err(|error| format!("Could not install the Claude status line bridge: {error}"))
}

#[tauri::command]
pub async fn agent_quota_claude_bridge_remove<R: Runtime>(
    app: AppHandle<R>,
    profile_dir: String,
) -> Result<BridgeStatus, String> {
    ensure_enabled(&app)?;
    let dir = profile(&profile_dir)?;
    remove_bridge(&dir, &exe()?, Platform::CURRENT)
        .map_err(|error| format!("Could not remove the Claude status line bridge: {error}"))
}

#[tauri::command]
pub async fn agent_quota_agy_bridge_status<R: Runtime>(
    app: AppHandle<R>,
    profile_dir: String,
) -> Result<BridgeStatus, String> {
    ensure_enabled(&app)?;
    Ok(agy_bridge_status(
        &profile(&profile_dir)?,
        &exe()?,
        Platform::CURRENT,
    ))
}

#[tauri::command]
pub async fn agent_quota_agy_bridge_install<R: Runtime>(
    app: AppHandle<R>,
    profile_dir: String,
) -> Result<BridgeStatus, String> {
    ensure_enabled(&app)?;
    install_agy_bridge(&profile(&profile_dir)?, &exe()?, Platform::CURRENT)
        .map_err(|error| format!("Could not install the Antigravity status line bridge: {error}"))
}

#[tauri::command]
pub async fn agent_quota_agy_bridge_remove<R: Runtime>(
    app: AppHandle<R>,
    profile_dir: String,
) -> Result<BridgeStatus, String> {
    ensure_enabled(&app)?;
    remove_agy_bridge(&profile(&profile_dir)?, &exe()?, Platform::CURRENT)
        .map_err(|error| format!("Could not remove the Antigravity status line bridge: {error}"))
}

/// The status line a Claude conversation of the profile last showed and how full its context was,
/// for its pane's footer; `None` while there is no fresh one (or Agent Quota, which installs the
/// bridge, is off).
#[tauri::command]
pub async fn agent_quota_statusline_text<R: Runtime>(
    app: AppHandle<R>,
    profile_dir: String,
    session_id: String,
) -> Result<Option<StatuslineRecord>, String> {
    if !crate::builtin_features::is_enabled(&app, AGENT_QUOTA) {
        return Ok(None);
    }
    let dir = profile(&profile_dir)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        });
    Ok(read_statusline(&dir, &session_id, now))
}

#[cfg(test)]
#[path = "bridge_commands_tests.rs"]
mod tests;
