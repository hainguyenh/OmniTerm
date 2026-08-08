//! The Always Awake rules: what is stored, what the frontend sees, and the two questions the poller
//! asks on every tick — is this schedule still running, and is any terminal actually working?
//!
//! Split out of `always_awake.rs` so the decisions live apart from the runtime plumbing that applies
//! them. Nothing here touches Tauri, the filesystem or the OS, which is what makes it testable.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AwakeMode {
    Always,
    #[default]
    ActiveOnly,
}

/// What survives a restart. Note the field names are *not* camelCased: this is the on-disk format,
/// not the wire format, and renaming it would orphan every saved schedule.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(super) struct StoredState {
    pub(super) enabled: bool,
    pub(super) mode: AwakeMode,
    pub(super) expires_at_ms: i64,
}

impl Default for StoredState {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: AwakeMode::ActiveOnly,
            expires_at_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwakeStatus {
    pub enabled: bool,
    pub mode: AwakeMode,
    pub expires_at_ms: i64,
    pub active_session_count: usize,
    pub keeping_awake: bool,
    pub supported: bool,
    pub error: Option<String>,
}

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

/// One session as Always Awake sees it, copied out of the DashMap so no shard guard is held across
/// the process snapshot. Same reason `session_activity::Target` exists — and, like it, this is what
/// makes the activity rule testable without standing up a real PTY.
pub struct AwakeTarget {
    pub ssh: bool,
    pub launched_with_command: bool,
    pub pid: Option<u32>,
}

pub(super) fn session_is_active(
    target: &AwakeTarget,
    table: &crate::proc_activity::ProcTable,
) -> bool {
    // SSH is intentionally conservative: Windows OpenSSH exposes the transport process but not
    // whether the remote shell is at a prompt, so any connected SSH PTY counts as active.
    target.ssh
        || target.launched_with_command
        || target.pid.is_some_and(|pid| table.has_descendant(pid))
}

pub(super) fn active_session_count(
    targets: &[AwakeTarget],
    table: &crate::proc_activity::ProcTable,
) -> usize {
    targets
        .iter()
        .filter(|target| session_is_active(target, table))
        .count()
}

pub(super) fn should_keep_awake(stored: &StoredState, active_count: usize) -> bool {
    stored.enabled
        && (stored.mode == AwakeMode::Always || active_count > 0)
        && cfg!(windows)
}

pub(super) fn is_expired(stored: &StoredState, now: i64) -> bool {
    stored.enabled && stored.expires_at_ms > 0 && stored.expires_at_ms <= now
}

#[cfg(test)]
#[path = "awake_schedule_tests.rs"]
mod tests;
