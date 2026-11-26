//! The status line a Claude conversation last showed, kept so OmniTerm can show it in the pane the
//! conversation runs in. The status line bridge (claude_bridge_run.rs) writes, after every render,
//! the exact text it printed to `<profile>/omniterm/statuslines/<session_id>.json`, with how full
//! the conversation's context window was; the pane footer reads it back by the conversation id the
//! pane tracks.
//!
//! Writing never fails the status line: any error only means the footer falls back to the quota.
//! The session id names a file, so only plain ids (letters, digits, `-`, `_`) are ever used.

use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use serde_json::{json, Value};

use super::claude_bridge::{BRIDGE_DIR, MAX_AGE_MS};
use super::claude_bridge_run::write_atomic;

const STATUSLINES_DIR: &str = "statuslines";
const MAX_SESSION_ID: usize = 128;
/// A status line is one or a few short rows; anything longer is cut, never stored whole.
const MAX_TEXT_CHARS: usize = 2000;
/// Records of conversations nobody has rendered for this long are removed.
const PRUNE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);
/// Clock skew tolerated for a record written "in the future".
const FUTURE_SKEW_MS: i64 = 60 * 1000;

/// What a conversation's status line last showed, for its pane's footer.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatuslineRecord {
    /// The exact text the bridge printed (terminal escapes included).
    pub text: String,
    /// How full the context window was, in percent, when Claude Code reported it.
    pub context_pct: Option<f64>,
}

/// The session id when it is safe as a file name, else `None`.
pub(crate) fn safe_session_id(id: &str) -> Option<&str> {
    let valid = !id.is_empty()
        && id.len() <= MAX_SESSION_ID
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    valid.then_some(id)
}

fn statuslines_dir(profile_dir: &Path) -> PathBuf {
    profile_dir.join(BRIDGE_DIR).join(STATUSLINES_DIR)
}

fn statusline_file(profile_dir: &Path, session_id: &str) -> Option<PathBuf> {
    let id = safe_session_id(session_id)?;
    Some(statuslines_dir(profile_dir).join(format!("{id}.json")))
}

/// Keep the text the bridge printed for the conversation the status line input names. Nothing is
/// written for an input without a usable `session_id`.
pub(crate) fn store_statusline(
    profile_dir: &Path,
    input: Option<&Value>,
    text: &str,
    context_pct: Option<f64>,
    now_ms: i64,
) -> io::Result<()> {
    let Some(file) = input
        .and_then(|doc| doc.get("session_id"))
        .and_then(Value::as_str)
        .and_then(|id| statusline_file(profile_dir, id))
    else {
        return Ok(());
    };
    let first_write = !file.exists();
    let text: String = text.chars().take(MAX_TEXT_CHARS).collect();
    let record = json!({
        "version": 1,
        "writtenAt": now_ms,
        "text": text,
        "contextPct": context_pct,
    });
    write_atomic(&file, &record.to_string())?;
    // A new conversation is the moment to drop the records of long-finished ones.
    if first_write {
        prune(&statuslines_dir(profile_dir), SystemTime::now());
    }
    Ok(())
}

/// Remove records older than `PRUNE_AFTER`; best effort.
fn prune(dir: &Path, now: SystemTime) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > PRUNE_AFTER);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// The record, or `None` when it is malformed, blank or older than the quota records.
pub(crate) fn parse_statusline_record(raw: &str, now_ms: i64) -> Option<StatuslineRecord> {
    let doc: Value = serde_json::from_str(raw).ok()?;
    let written = doc.get("writtenAt").and_then(Value::as_i64)?;
    if now_ms.saturating_sub(written) > MAX_AGE_MS
        || written > now_ms.saturating_add(FUTURE_SKEW_MS)
    {
        return None;
    }
    let text = doc
        .get("text")
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())?;
    let context_pct = doc
        .get("contextPct")
        .and_then(Value::as_f64)
        .filter(|pct| pct.is_finite())
        .map(|pct| pct.clamp(0.0, 100.0));
    Some(StatuslineRecord {
        text: text.to_string(),
        context_pct,
    })
}

/// The status line a conversation of this profile last showed, while it is fresh.
pub fn read_statusline(
    profile_dir: &Path,
    session_id: &str,
    now_ms: i64,
) -> Option<StatuslineRecord> {
    let file = statusline_file(profile_dir, session_id)?;
    let raw = std::fs::read_to_string(file).ok()?;
    parse_statusline_record(&raw, now_ms)
}

#[cfg(test)]
#[path = "statusline_store_tests.rs"]
mod tests;
