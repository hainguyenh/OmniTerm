//! Index of the agent conversations kept on disk, for the Sessions window's "Clean Up Sessions".
//!
//! Every agent profile keeps its own history: Claude Code under
//! `<profile>/projects/<encoded cwd>/<uuid>.jsonl`, Codex under
//! `<profile>/sessions/YYYY/MM/DD/rollout-*.jsonl`. Profiles are the same directories the quota
//! dashboard knows: `~/.claude`, `~/.claude-<x>`, `~/claude-profiles/<x>`, `~/.codex`,
//! `~/.codex-<x>`.
//!
//! Listing reads only the head of each file (the working directory and the first prompt, so the
//! user can tell sessions apart). Deleting takes ids from a listing and resolves them against a
//! fresh scan, so the renderer can never name a path: only a file this module found as a session
//! of a known profile is ever removed.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::agent_session_header::{read_header, SessionHeader};

#[cfg(test)]
#[path = "agent_session_index_tests.rs"]
mod tests;

/// A PATH-sized home with thousands of conversations stays responsive; the oldest are listed last
/// anyway, so a cap never hides the recent ones the user is deciding about.
pub const MAX_SESSIONS: usize = 5000;
const PROFILE_SUFFIX_MAX: usize = 40;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionAgent {
    Claude,
    Codex,
}

/// One profile directory whose conversations are indexed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionRoot {
    pub agent: SessionAgent,
    /// `claude`, `claude-work`, `codex`, ... (unique across roots).
    pub profile: String,
    pub dir: PathBuf,
}

/// One conversation on disk, as the cleanup table shows it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionFile {
    /// `<agent>:<profile>:<session id>`; what `delete_sessions` takes back.
    pub id: String,
    pub agent: SessionAgent,
    pub profile: String,
    pub session_id: String,
    /// Working directory the conversation ran in, when its head says.
    pub cwd: Option<String>,
    /// First prompt, shortened.
    pub title: Option<String>,
    /// Modification time, epoch milliseconds.
    pub last_active: u64,
    /// Bytes on disk (the transcript file).
    pub size: u64,
    #[serde(skip)]
    pub path: PathBuf,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReport {
    pub deleted: Vec<String>,
    /// Ids that were not deleted, with the reason.
    pub failed: Vec<(String, String)>,
}

fn is_profile_suffix(suffix: &str) -> bool {
    !suffix.is_empty()
        && suffix.len() <= PROFILE_SUFFIX_MAX
        && suffix
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
}

fn is_real_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir())
}

fn sorted_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| entry.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();
    names.sort_by_key(|name| name.to_ascii_lowercase());
    names
}

/// Every profile directory under `home`, defaults first, then the named ones by name. A profile
/// name found twice (`~/.claude-work` and `~/claude-profiles/work`) is numbered the second time.
pub fn session_roots(home: &Path) -> Vec<SessionRoot> {
    let mut roots = Vec::new();
    for (agent, name) in [
        (SessionAgent::Claude, "claude"),
        (SessionAgent::Codex, "codex"),
    ] {
        let dir = home.join(format!(".{name}"));
        if is_real_dir(&dir) {
            roots.push((agent, name.to_string(), dir));
        }
    }
    for entry in sorted_names(home) {
        for (agent, prefix) in [
            (SessionAgent::Claude, ".claude-"),
            (SessionAgent::Codex, ".codex-"),
        ] {
            let Some(suffix) = entry.strip_prefix(prefix) else {
                continue;
            };
            let dir = home.join(&entry);
            if is_profile_suffix(suffix) && is_real_dir(&dir) {
                roots.push((agent, format!("{}{suffix}", &prefix[1..]), dir));
            }
        }
    }
    let profiles_dir = home.join("claude-profiles");
    for entry in sorted_names(&profiles_dir) {
        let suffix = entry.strip_prefix("claude-").unwrap_or(&entry);
        let dir = profiles_dir.join(&entry);
        if is_profile_suffix(suffix) && is_real_dir(&dir) {
            roots.push((SessionAgent::Claude, format!("claude-{suffix}"), dir));
        }
    }
    let mut seen: HashMap<String, usize> = HashMap::new();
    roots
        .into_iter()
        .map(|(agent, profile, dir)| {
            let count = seen.entry(profile.to_ascii_lowercase()).or_insert(0);
            *count += 1;
            let profile = if *count == 1 {
                profile
            } else {
                format!("{profile} ({count})")
            };
            SessionRoot {
                agent,
                profile,
                dir,
            }
        })
        .collect()
}

/// Regular files (never symlinks) with the `.jsonl` extension directly inside `dir`.
fn jsonl_files(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
                .map(|entry| entry.path())
                .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
                .collect()
        })
        .unwrap_or_default()
}

fn real_subdirs(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                .map(|entry| entry.path())
                .collect()
        })
        .unwrap_or_default()
}

/// Transcript files of one profile: Claude's one level under `projects/`, Codex's three levels
/// (year, month, day) under `sessions/`.
fn transcript_files(root: &SessionRoot) -> Vec<PathBuf> {
    match root.agent {
        SessionAgent::Claude => real_subdirs(&root.dir.join("projects"))
            .iter()
            .flat_map(|dir| jsonl_files(dir))
            .collect(),
        SessionAgent::Codex => {
            let mut dirs = vec![root.dir.join("sessions")];
            for _ in 0..3 {
                dirs = dirs.iter().flat_map(|dir| real_subdirs(dir)).collect();
            }
            dirs.iter().flat_map(|dir| jsonl_files(dir)).collect()
        }
    }
}

/// The session id of a transcript: Claude names the file after it; Codex puts it in the head, and
/// a rollout without one falls back to its file name.
fn session_id_of(agent: SessionAgent, path: &Path, header: &SessionHeader) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    match agent {
        SessionAgent::Claude => Some(stem.to_string()),
        SessionAgent::Codex => Some(
            header
                .session_id
                .clone()
                .unwrap_or_else(|| stem.to_string()),
        ),
    }
}

fn describe(root: &SessionRoot, path: PathBuf) -> Option<AgentSessionFile> {
    let meta = fs::symlink_metadata(&path).ok()?;
    let header = read_header(&path, root.agent);
    let session_id = session_id_of(root.agent, &path, &header)?;
    let last_active = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        });
    let agent_name = match root.agent {
        SessionAgent::Claude => "claude",
        SessionAgent::Codex => "codex",
    };
    Some(AgentSessionFile {
        id: format!("{agent_name}:{}:{session_id}", root.profile),
        agent: root.agent,
        profile: root.profile.clone(),
        session_id,
        cwd: header.cwd,
        title: header.title,
        last_active,
        size: meta.len(),
        path,
    })
}

/// Every conversation of every root, newest first, at most [`MAX_SESSIONS`].
pub fn list_sessions(roots: &[SessionRoot]) -> Vec<AgentSessionFile> {
    let mut sessions: Vec<AgentSessionFile> = roots
        .iter()
        .flat_map(|root| {
            transcript_files(root)
                .into_iter()
                .filter_map(move |path| describe(root, path))
        })
        .collect();
    sessions.sort_by(|a, b| {
        b.last_active
            .cmp(&a.last_active)
            .then_with(|| a.id.cmp(&b.id))
    });
    sessions.truncate(MAX_SESSIONS);
    sessions
}

/// Removes `path` when it is a real file or directory; a symlink or a missing entry is left alone.
fn remove_owned(path: &Path) -> std::io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(path),
        Ok(meta) if meta.is_file() => fs::remove_file(path),
        _ => Ok(()),
    }
}

/// What Claude keeps beside a transcript for the same session: its sub-agent folder, file
/// checkpoints, shell snapshots and todo lists. Only entries named after the (UUID) session id.
fn claude_companions(root: &SessionRoot, session: &AgentSessionFile) -> Vec<PathBuf> {
    let id = &session.session_id;
    let mut paths = Vec::new();
    if let Some(parent) = session.path.parent() {
        paths.push(parent.join(id));
    }
    paths.push(root.dir.join("file-history").join(id));
    paths.push(root.dir.join("session-env").join(id));
    let todos = root.dir.join("todos");
    paths.extend(
        sorted_names(&todos)
            .into_iter()
            .filter(|name| name.starts_with(id.as_str()) && name.ends_with(".json"))
            .map(|name| todos.join(name)),
    );
    paths
}

/// Deletes the listed conversations. Each id is looked up in a fresh scan of `roots`; an id that
/// is not there (already gone, or never a session) is reported as failed and nothing is touched.
pub fn delete_sessions(roots: &[SessionRoot], ids: &[String]) -> DeleteReport {
    let mut by_id: HashMap<String, (&SessionRoot, AgentSessionFile)> = HashMap::new();
    for root in roots {
        for path in transcript_files(root) {
            if let Some(session) = describe(root, path) {
                by_id.insert(session.id.clone(), (root, session));
            }
        }
    }
    let mut report = DeleteReport::default();
    for id in ids {
        let Some((root, session)) = by_id.get(id) else {
            report
                .failed
                .push((id.clone(), "Session not found".to_string()));
            continue;
        };
        if let Err(error) = remove_owned(&session.path) {
            report.failed.push((id.clone(), error.to_string()));
            continue;
        }
        if root.agent == SessionAgent::Claude
            && crate::agent_session_header::is_uuid(&session.session_id)
        {
            for companion in claude_companions(root, session) {
                if let Err(error) = remove_owned(&companion) {
                    log::warn!(
                        "[agent-sessions] could not remove {}: {error}",
                        companion.display()
                    );
                }
            }
        }
        report.deleted.push(id.clone());
    }
    report
}
