//! Deletes the conversations a listing showed. Each id is resolved against a fresh scan of the
//! profiles it names, so the renderer can never name a path: only a file found as a session of a
//! known profile, and the entries the agent keeps beside it under the same UUID, are removed.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use super::gemini::agy_companions;
use super::roots::sorted_names;
use super::{
    candidates, describe, AgentSessionFile, Candidate, DeleteReport, SessionAgent, SessionRoot,
};
use crate::agent_session_header::{is_uuid, read_header, SessionHeader};
use crate::parallel::{Progress, Step};

/// Removes `path` when it is a real file or directory; a symlink or a missing entry is left alone.
pub(super) fn remove_owned(path: &Path) -> std::io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(path),
        Ok(meta) if meta.is_file() => fs::remove_file(path),
        _ => Ok(()),
    }
}

/// What Claude keeps beside a transcript for the same session: its sub-agent folder, file
/// checkpoints, shell snapshots and todo lists. Only entries named after the (UUID) session id.
pub(super) fn claude_companions(root: &SessionRoot, session: &AgentSessionFile) -> Vec<PathBuf> {
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

fn companions(root: &SessionRoot, session: &AgentSessionFile) -> Vec<PathBuf> {
    if !is_uuid(&session.session_id) {
        return Vec::new();
    }
    match root.agent {
        SessionAgent::Claude => claude_companions(root, session),
        SessionAgent::Agy => agy_companions(root, &session.session_id),
        SessionAgent::Codex | SessionAgent::Gemini => Vec::new(),
    }
}

/// `<agent>:<profile>:<session id>` split in its profile and session id.
fn id_parts(id: &str) -> Option<(&str, &str)> {
    let mut parts = id.splitn(3, ':');
    parts.next()?;
    Some((parts.next()?, parts.next()?))
}

type Found<'a> = HashMap<String, (&'a SessionRoot, AgentSessionFile)>;

fn index_candidate<'a>(candidate: Candidate<'a>, found: &mut Found<'a>) {
    let root = candidate.root;
    // Only a Codex rollout keeps its id inside; every other session is named by its file.
    let header = match root.agent {
        SessionAgent::Codex => read_header(&candidate.path, root.agent),
        _ => SessionHeader::default(),
    };
    if let Some(session) = describe(candidate, header) {
        found.insert(session.id.clone(), (root, session));
    }
}

/// The sessions among `roots` that `ids` may name. Codex rollouts whose file name does not hold a
/// requested id are opened only when the others leave an id unresolved: a batch of a large
/// cleanup must not reread every rollout head.
fn find_sessions<'a>(roots: &'a [SessionRoot], ids: &[String]) -> Found<'a> {
    let wanted: Vec<&str> = ids
        .iter()
        .filter_map(|id| id_parts(id))
        .map(|(_, s)| s)
        .collect();
    let mut found = Found::new();
    let mut deferred = Vec::new();
    for candidate in candidates(roots) {
        let named = candidate
            .path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .is_some_and(|stem| wanted.iter().any(|id| stem.contains(id)));
        if candidate.root.agent == SessionAgent::Codex && !named {
            deferred.push(candidate);
        } else {
            index_candidate(candidate, &mut found);
        }
    }
    if ids.iter().any(|id| !found.contains_key(id)) {
        for candidate in deferred {
            index_candidate(candidate, &mut found);
        }
    }
    found
}

/// Deletes the listed conversations. Each id is looked up in a fresh scan of the profiles the ids
/// name; an id that is not there (already gone, or never a session) is reported as failed and
/// nothing is touched.
pub fn delete_sessions(roots: &[SessionRoot], ids: &[String]) -> DeleteReport {
    static NEVER: AtomicBool = AtomicBool::new(false);
    delete_sessions_with(
        roots,
        ids,
        &Progress {
            on_step: &|_| {},
            cancel: &NEVER,
        },
    )
}

/// [`delete_sessions`] with progress after every id. The profiles are scanned once for the whole
/// list (a clean-up of thousands used to rescan them for every small batch). Cancelling stops
/// before the next id; the ids not reached are reported as failed with "Cancelled".
pub fn delete_sessions_with(
    roots: &[SessionRoot],
    ids: &[String],
    progress: &Progress<'_>,
) -> DeleteReport {
    let profiles: HashSet<&str> = ids
        .iter()
        .filter_map(|id| id_parts(id))
        .map(|(p, _)| p)
        .collect();
    let scoped: Vec<SessionRoot> = roots
        .iter()
        .filter(|root| profiles.contains(root.profile.as_str()))
        .cloned()
        .collect();
    let found = find_sessions(&scoped, ids);
    let mut report = DeleteReport::default();
    let total = ids.len() as u64;
    let mut freed = 0;
    for (index, id) in ids.iter().enumerate() {
        if progress.cancelled() {
            report.failed.extend(
                ids[index..]
                    .iter()
                    .map(|id| (id.clone(), "Cancelled".to_string())),
            );
            break;
        }
        if let Some(size) = delete_one(&found, id, &mut report) {
            freed += size;
        }
        (progress.on_step)(Step {
            done: index as u64 + 1,
            total,
            bytes: freed,
        });
    }
    report
}

/// Deletes the conversation `id` and its companions; its transcript's size once deleted.
fn delete_one(found: &Found<'_>, id: &str, report: &mut DeleteReport) -> Option<u64> {
    let Some((root, session)) = found.get(id) else {
        report
            .failed
            .push((id.to_string(), "Session not found".to_string()));
        return None;
    };
    if let Err(error) = remove_owned(&session.path) {
        report.failed.push((id.to_string(), error.to_string()));
        return None;
    }
    for companion in companions(root, session) {
        if let Err(error) = remove_owned(&companion) {
            log::warn!(
                "[agent-sessions] could not remove {}: {error}",
                companion.display()
            );
        }
    }
    report.deleted.push(id.to_string());
    Some(session.size)
}

#[cfg(test)]
#[path = "agent_session_delete_tests.rs"]
mod tests;
