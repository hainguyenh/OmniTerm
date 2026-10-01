//! Deterministic Claude session-file lookup for pane resume.
//!
//! This does not guess a profile from renderer-supplied strings and does not read chat history or
//! prompt text. The caller (see `resolve_pane_agent_session` on the frontend) first asks
//! `agent_quota::agent_quota_detect` which agent runs under a pane's shell process tree, and which
//! profile directory it actually uses (from its own `CLAUDE_CONFIG_DIR` environment or the default
//! `~/.claude`). Only then does this module look for the session file that agent would resume,
//! restricted to files whose name is a UUID and whose modification time is not older than the
//! agent process itself — so a file planted before the agent started, or named to look like a
//! shell command, is never picked up or returned.
//!
//! The resolver never reads chat history. `export_claude_transcript` does, but only when the user
//! explicitly saves a pane's output: the rendered conversation (see
//! `app_core::claude_transcript`) goes straight back to the save flow, which writes it only to the
//! file the user picks in the native dialog. It takes the same detected profile directory and a
//! bare UUID session id, so it can only ever open a `<uuid>.jsonl` inside that profile.

use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};

#[cfg(test)]
#[path = "agent_session_tests.rs"]
mod tests;

/// Strict `8-4-4-4-12` hex UUID, case-insensitive, no braces or other decoration. Anything else is
/// rejected before it can reach a session file name or a resume command.
pub fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    bytes.iter().enumerate().all(|(i, b)| match i {
        8 | 13 | 18 | 23 => *b == b'-',
        _ => b.is_ascii_hexdigit(),
    })
}

/// Claude's project-directory encoding: every non-alphanumeric ASCII character becomes `-`, one
/// for one (`D:\workspace\OmniTerm` -> `D--workspace-OmniTerm`).
pub fn encode_project_dir(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// The newest `<uuid>.jsonl` under `<profile_dir>/projects/<encoded cwd>/`, ignoring any entry
/// whose name is not a bare UUID and (when `since_epoch_secs` is given) any file that predates the
/// agent process by more than a few seconds of clock-skew grace.
fn resolve_claude_session_file(
    profile_dir: &Path,
    cwd: &str,
    since_epoch_secs: Option<u64>,
) -> Option<String> {
    let clean_cwd = cwd.trim_end_matches(['/', '\\']);
    let dir = profile_dir.join("projects").join(encode_project_dir(clean_cwd));
    let entries = fs::read_dir(&dir).ok()?;

    const CLOCK_SKEW_GRACE_SECS: u64 = 5;
    let mut best: Option<(String, SystemTime)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if !is_uuid(stem) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if let Some(since) = since_epoch_secs {
            let modified_secs = modified
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            if modified_secs + CLOCK_SKEW_GRACE_SECS < since {
                continue;
            }
        }
        let is_newer = match &best {
            Some((_, t)) => modified > *t,
            None => true,
        };
        if is_newer {
            best = Some((stem.to_string(), modified));
        }
    }
    best.map(|(id, _)| id)
}

/// Look up the Claude session file for one pane's agent. `profile_dir` and `since_epoch_secs` must
/// come from `agent_quota_detect` (the agent's own process, never a renderer-typed value); `cwd` is
/// the pane's last reported working directory.
#[tauri::command]
pub async fn resolve_claude_session(
    profile_dir: String,
    cwd: String,
    since_epoch_secs: Option<u64>,
) -> Result<Option<String>, String> {
    if profile_dir.trim().is_empty() || cwd.trim().is_empty() {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(move || {
        resolve_claude_session_file(Path::new(&profile_dir), &cwd, since_epoch_secs)
    })
    .await
    .map_err(|error| format!("Session lookup failed: {error}"))
}

/// The whole conversation of one Claude session as plain text, for the pane's "Save output".
/// `profile_dir` must come from `agent_quota_detect`; `session_id` must be a bare UUID.
#[tauri::command]
pub async fn export_claude_transcript(
    profile_dir: String,
    session_id: String,
) -> Result<String, String> {
    if profile_dir.trim().is_empty() || !is_uuid(&session_id) {
        return Err("Invalid Claude session.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        app_core::claude_transcript::export_transcript(Path::new(&profile_dir), &session_id)
    })
    .await
    .map_err(|error| format!("Transcript export failed: {error}"))?
    .map_err(|error| format!("Transcript export failed: {error}"))
}

fn store_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("agent-sessions.json"))
        .map_err(|error| format!("Failed to get app data dir: {error}"))
}

/// The crash-safe copy of the renderer's resumable sessions and bookmarks (see
/// `app_core::agent_sessions`), or `null` when there is none yet or it is unreadable.
#[tauri::command]
pub async fn agent_sessions_load<R: Runtime>(app: AppHandle<R>) -> Result<Option<Value>, String> {
    let path = store_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || app_core::agent_sessions::load_store(&path))
        .await
        .map_err(|error| format!("Session store read failed: {error}"))
}

/// Atomically replace the crash-safe copy. The renderer re-validates everything it reads back.
#[tauri::command]
pub async fn agent_sessions_save<R: Runtime>(
    app: AppHandle<R>,
    document: Value,
) -> Result<(), String> {
    let path = store_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        app_core::agent_sessions::save_store(&path, &document)
    })
    .await
    .map_err(|error| format!("Session store write failed: {error}"))?
    .map_err(|error| format!("Session store write failed: {error}"))
}
