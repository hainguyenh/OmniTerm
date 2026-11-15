//! IPC for the Sessions window's "Clean Up Sessions": list the agent conversations kept on disk
//! and delete the ones the user picks. The logic lives in `app_core::agent_session_index`; deleting
//! takes ids from a listing, never paths.

use app_core::agent_session_index::{
    delete_sessions, list_sessions, session_roots, AgentSessionFile, DeleteReport,
};
use std::path::PathBuf;

/// The most ids one delete call accepts; a listing never has more.
const MAX_DELETE_IDS: usize = app_core::agent_session_index::MAX_SESSIONS;

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "No home directory.".to_string())
}

/// Every conversation of every agent profile, newest first.
#[tauri::command]
pub async fn agent_session_files_list() -> Result<Vec<AgentSessionFile>, String> {
    let home = home_dir()?;
    tauri::async_runtime::spawn_blocking(move || list_sessions(&session_roots(&home)))
        .await
        .map_err(|error| format!("Session listing failed: {error}"))
}

/// Deletes the conversations with these ids (from `agent_session_files_list`).
#[tauri::command]
pub async fn agent_session_files_delete(ids: Vec<String>) -> Result<DeleteReport, String> {
    if ids.len() > MAX_DELETE_IDS || ids.iter().any(|id| id.len() > 256) {
        return Err("Invalid session list.".to_string());
    }
    let home = home_dir()?;
    tauri::async_runtime::spawn_blocking(move || delete_sessions(&session_roots(&home), &ids))
        .await
        .map_err(|error| format!("Session delete failed: {error}"))
}
