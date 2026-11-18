//! IPC for the Sessions window's "Clean Up Sessions": list the agent conversations kept on disk
//! and delete the ones the user picks. The logic lives in `app_core::agent_session_index`; deleting
//! takes ids from a listing, never paths.

use app_core::agent_session_index::{
    delete_sessions, list_sessions_idle, session_roots, AgentSessionFile, DeleteReport,
    SessionAgent, SessionRoot,
};
use serde::Serialize;
use std::path::PathBuf;

/// The most ids one delete call accepts; a listing never has more.
const MAX_DELETE_IDS: usize = app_core::agent_session_index::MAX_SESSIONS;

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "No home directory.".to_string())
}

/// Ten years: a longer idle time is the same as "nothing".
const MAX_IDLE_DAYS: u32 = 3650;

/// The most profiles one listing may be narrowed to.
const MAX_PROFILES: usize = 256;

/// One agent profile folder on this machine (`claude`, `claude-work`, `codex`, ...).
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct SessionProfile {
    pub agent: SessionAgent,
    pub profile: String,
}

/// The agent profiles on this machine: their folders only, nothing inside them is read.
#[tauri::command]
pub async fn agent_session_profiles_list() -> Result<Vec<SessionProfile>, String> {
    let home = home_dir()?;
    tauri::async_runtime::spawn_blocking(move || {
        session_roots(&home)
            .into_iter()
            .map(|root| SessionProfile {
                agent: root.agent,
                profile: root.profile,
            })
            .collect()
    })
    .await
    .map_err(|error| format!("Profile listing failed: {error}"))
}

/// The roots among `roots` that `profiles` names; every root when it names none.
fn narrowed(roots: Vec<SessionRoot>, profiles: Option<&[String]>) -> Vec<SessionRoot> {
    match profiles {
        Some(profiles) => roots
            .into_iter()
            .filter(|root| profiles.contains(&root.profile))
            .collect(),
        None => roots,
    }
}

/// The conversations of the given agent profiles (all of them without `profiles`), newest first.
/// `older_than_days` keeps only the conversations idle that long, applied before the listing cap.
#[tauri::command]
pub async fn agent_session_files_list(
    profiles: Option<Vec<String>>,
    older_than_days: Option<u32>,
) -> Result<Vec<AgentSessionFile>, String> {
    if let Some(profiles) = &profiles {
        if profiles.len() > MAX_PROFILES || profiles.iter().any(|profile| profile.len() > 128) {
            return Err("Invalid profile list.".to_string());
        }
    }
    let home = home_dir()?;
    let min_idle_ms = u64::from(older_than_days.unwrap_or(0).min(MAX_IDLE_DAYS)) * 86_400_000;
    tauri::async_runtime::spawn_blocking(move || {
        list_sessions_idle(
            &narrowed(session_roots(&home), profiles.as_deref()),
            min_idle_ms,
        )
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    fn root(agent: SessionAgent, profile: &str) -> SessionRoot {
        SessionRoot {
            agent,
            profile: profile.to_string(),
            dir: PathBuf::from(profile),
        }
    }

    #[test]
    fn a_listing_keeps_only_the_profiles_asked_for() {
        let roots = vec![
            root(SessionAgent::Claude, "claude"),
            root(SessionAgent::Claude, "claude-work"),
            root(SessionAgent::Codex, "codex"),
        ];
        let asked = ["claude-work".to_string()];
        let kept: Vec<String> = narrowed(roots.clone(), Some(&asked))
            .into_iter()
            .map(|r| r.profile)
            .collect();
        assert_eq!(kept, ["claude-work"]);
        assert_eq!(
            narrowed(roots, None).len(),
            3,
            "no profiles named: every root"
        );
    }
}
