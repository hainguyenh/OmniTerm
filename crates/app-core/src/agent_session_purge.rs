//! Removes the empty Claude conversations OmniTerm's own quota probe leaves behind. The probe starts
//! each hidden profile's agent in a scratch folder, types `/usage` and `/exit`, and every run leaves
//! a transcript with no prompt in it that Claude's resume list then shows as an empty session.

use super::delete::{claude_companions, remove_owned};
use super::{candidates, describe, real_subdirs, SessionAgent, SessionRoot};
use crate::agent_session_header::{is_uuid, read_header};

/// Claude names a project folder after its working directory with every character that is not an
/// ASCII letter or digit replaced by `-`.
fn encoded(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Deletes the transcripts, and what Claude keeps beside them, of every Claude profile's project
/// folder for a directory named `scratch_name` (the temp folder has a short and a long path form,
/// so the folder is matched by its last component). Only a transcript without any prompt, idle at
/// least `min_idle_ms` at `now_ms`, is removed: a probe still running is never touched, and
/// anything the user typed there is kept. Returns how many were removed.
pub fn purge_probe_sessions(
    roots: &[SessionRoot],
    scratch_name: &str,
    min_idle_ms: u64,
    now_ms: u64,
) -> usize {
    let suffix = format!("-{}", encoded(scratch_name));
    if suffix.len() < 2 {
        return 0;
    }
    let scratch_roots: Vec<SessionRoot> = roots
        .iter()
        .filter(|root| root.agent == SessionAgent::Claude)
        .filter(|root| {
            real_subdirs(&root.dir.join("projects")).iter().any(|dir| {
                dir.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.ends_with(&suffix))
            })
        })
        .cloned()
        .collect();
    let cutoff = now_ms.saturating_sub(min_idle_ms);
    let mut removed = 0;
    for candidate in candidates(&scratch_roots) {
        let in_scratch = candidate
            .path
            .parent()
            .and_then(|dir| dir.file_name())
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(&suffix));
        if !in_scratch || candidate.last_active > cutoff {
            continue;
        }
        let root = candidate.root;
        let header = read_header(&candidate.path, SessionAgent::Claude);
        let Some(session) = describe(candidate, header) else {
            continue;
        };
        if !session.empty {
            continue;
        }
        if let Err(error) = remove_owned(&session.path) {
            log::warn!(
                "[agent-sessions] could not remove probe session {}: {error}",
                session.path.display()
            );
            continue;
        }
        // Companions are named after the session id; only a UUID one can never name something else.
        if is_uuid(&session.session_id) {
            for companion in claude_companions(root, &session) {
                let _ = remove_owned(&companion);
            }
        }
        removed += 1;
    }
    removed
}

#[cfg(test)]
#[path = "agent_session_purge_tests.rs"]
mod tests;
