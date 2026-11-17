//! Index of the agent conversations kept on disk, for the Sessions window's "Clean Up Sessions".
//!
//! Every agent profile keeps its own history: Claude Code under
//! `<profile>/projects/<encoded cwd>/<uuid>.jsonl`, Codex under
//! `<profile>/sessions/YYYY/MM/DD/rollout-*.jsonl`, Gemini CLI and Antigravity as described in
//! `agent_session_gemini.rs`. Claude and Codex profiles are the same directories the quota
//! dashboard knows: `~/.claude`, `~/.claude-<x>`, `~/claude-profiles/<x>`, `~/.codex`,
//! `~/.codex-<x>`; Gemini CLI's is `~/.gemini`, Antigravity's `~/.gemini/antigravity[-<x>]`.
//!
//! Listing reads only the head of each text transcript (the working directory and the first
//! prompt, so the user can tell sessions apart); Antigravity's conversation databases are never
//! opened. Deleting takes ids from a listing and resolves them against a
//! fresh scan, so the renderer can never name a path: only a file this module found as a session
//! of a known profile is ever removed.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::agent_session_header::{read_header, SessionHeader};

#[path = "agent_session_delete.rs"]
mod delete;
#[path = "agent_session_gemini.rs"]
mod gemini;
#[path = "agent_session_readers.rs"]
mod readers;
#[path = "agent_session_roots.rs"]
mod roots;

pub use delete::delete_sessions;
use readers::describe_all;
pub use roots::session_roots;
#[cfg(test)]
use {delete::remove_owned, roots::PROFILE_SUFFIX_MAX};

#[cfg(test)]
#[path = "agent_session_index_tests.rs"]
mod tests;

/// A PATH-sized home with thousands of conversations stays responsive; the oldest are listed last
/// anyway, so a cap never hides the recent ones the user is deciding about.
pub const MAX_SESSIONS: usize = 5000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionAgent {
    Claude,
    Codex,
    Gemini,
    /// Antigravity: the agy CLI and the Antigravity IDE's agent.
    Agy,
}

impl SessionAgent {
    /// The name ids and the renderer use (`claude`, `codex`, `gemini`, `agy`).
    pub fn name(self) -> &'static str {
        match self {
            SessionAgent::Claude => "claude",
            SessionAgent::Codex => "codex",
            SessionAgent::Gemini => "gemini",
            SessionAgent::Agy => "agy",
        }
    }
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

/// Regular files (never symlinks) directly inside `dir`.
fn regular_files(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
                .map(|entry| entry.path())
                .collect()
        })
        .unwrap_or_default()
}

/// Regular files with the `.jsonl` extension directly inside `dir`.
fn jsonl_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = regular_files(dir);
    files.retain(|path| path.extension().is_some_and(|ext| ext == "jsonl"));
    files
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
/// (year, month, day) under `sessions/`, Gemini CLI's chats and Antigravity's conversations.
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
        SessionAgent::Gemini => gemini::gemini_chats(root),
        SessionAgent::Agy => gemini::agy_conversations(root),
    }
}

/// The session id of a transcript: Claude and Antigravity name the file after it, and a Gemini CLI
/// chat file name is unique to its conversation; Codex puts it in the head, and a rollout without
/// one falls back to its file name.
fn session_id_of(agent: SessionAgent, path: &Path, header: &SessionHeader) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    match agent {
        SessionAgent::Claude | SessionAgent::Gemini | SessionAgent::Agy => Some(stem.to_string()),
        SessionAgent::Codex => Some(
            header
                .session_id
                .clone()
                .unwrap_or_else(|| stem.to_string()),
        ),
    }
}

/// A transcript known by its file metadata only: listing a profile costs one `stat` per file.
struct Candidate<'a> {
    root: &'a SessionRoot,
    path: PathBuf,
    last_active: u64,
    size: u64,
}

/// What a transcript says about itself. Antigravity's databases are never opened; a Gemini CLI
/// chat's working directory comes from its project folder.
fn header_of(candidate: &Candidate<'_>) -> SessionHeader {
    match candidate.root.agent {
        SessionAgent::Agy => SessionHeader::default(),
        SessionAgent::Gemini => SessionHeader {
            cwd: gemini::gemini_project_dir(&candidate.path),
            ..read_header(&candidate.path, SessionAgent::Gemini)
        },
        agent => read_header(&candidate.path, agent),
    }
}

fn candidates(roots: &[SessionRoot]) -> Vec<Candidate<'_>> {
    roots
        .iter()
        .flat_map(|root| {
            transcript_files(root).into_iter().filter_map(move |path| {
                let meta = fs::symlink_metadata(&path).ok()?;
                let last_active = meta
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |elapsed| {
                        u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
                    });
                Some(Candidate {
                    root,
                    path,
                    last_active,
                    size: meta.len(),
                })
            })
        })
        .collect()
}

/// The listing entry of `candidate`. `header` is what its transcript says about itself; an empty
/// one is enough for every session but a Codex one, whose id is in its head.
fn describe(candidate: Candidate<'_>, header: SessionHeader) -> Option<AgentSessionFile> {
    let Candidate {
        root,
        path,
        last_active,
        size,
    } = candidate;
    let session_id = session_id_of(root.agent, &path, &header)?;
    Some(AgentSessionFile {
        id: format!("{}:{}:{session_id}", root.agent.name(), root.profile),
        agent: root.agent,
        profile: root.profile.clone(),
        session_id,
        cwd: header.cwd,
        title: header.title,
        last_active,
        size,
        path,
    })
}

/// Every conversation of every root, newest first, at most [`MAX_SESSIONS`].
///
/// The files are ranked by their modification time alone, and only the ones kept are opened: a
/// machine with tens of thousands of transcripts used to have every one of them parsed before the
/// list was cut, which left the cleanup dialog waiting for minutes.
pub fn list_sessions(roots: &[SessionRoot]) -> Vec<AgentSessionFile> {
    let mut candidates = candidates(roots);
    candidates.sort_by(|a, b| {
        b.last_active
            .cmp(&a.last_active)
            .then_with(|| a.path.cmp(&b.path))
    });
    candidates.truncate(MAX_SESSIONS);
    let mut sessions = describe_all(candidates);
    sessions.sort_by(|a, b| {
        b.last_active
            .cmp(&a.last_active)
            .then_with(|| a.id.cmp(&b.id))
    });
    sessions.truncate(MAX_SESSIONS);
    sessions
}
