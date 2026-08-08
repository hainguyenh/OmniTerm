//! Shared session lifecycle status type used by PTY source, output sink, and
//! the Tauri command boundary.
//!
//! Lives in `app_protocol` so `session_output.rs` (desktop adapter) and the
//! (future) CLI can both reference it from app-core without a Tauri dependency.

use serde::{Deserialize, Serialize};

/// Non-output pane status, kept in one tagged channel so ready/error/closed remain ordered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SessionStatus {
	/// The PTY is live; `label` is the shell name to show in the pane banner.
	Ready { label: String },
	Error { message: String },
	Closed { code: u32 },
	/// The shell is (or is no longer) running something — see session_activity.rs. Sent on change
	/// only, so the renderer can hold it as a plain flag.
	Activity { busy: bool },
}

#[cfg(test)]
#[path = "session_status_tests.rs"]
mod tests;
