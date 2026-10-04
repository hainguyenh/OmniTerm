//! DTOs for the built-in text editor's open/save round trip.
//!
//! The editor never receives raw bytes: the host decodes, strips a UTF-8 BOM and measures the text
//! once, so the renderer can pick a feature profile (highlighting, folding) before it builds the
//! document. Saving carries back the version the editor loaded so the host can refuse to overwrite a
//! file that changed on disk in the meantime.

use serde::{Deserialize, Serialize};

/// The dominant line ending of a file. A file with both kinds reports the majority here and sets
/// `mixed_eol`; the editor saves every line with this one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextEol {
    Lf,
    Crlf,
}

/// A text file as the editor opens it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileContent {
    /// Decoded UTF-8 text without a leading BOM (see `has_bom`).
    pub content: String,
    /// Size on disk in bytes, BOM included.
    pub size: u64,
    /// Last-modified time in milliseconds since the Unix epoch, or 0 when the platform has none.
    pub mtime_ms: u64,
    pub line_count: usize,
    /// Longest line in characters — what decides whether a minified file gets highlighting.
    pub max_line_len: usize,
    pub eol: TextEol,
    pub mixed_eol: bool,
    pub has_bom: bool,
    /// The file is marked read-only on disk; saving it would fail.
    pub read_only: bool,
}

/// One save from the editor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileSaveRequest {
    pub content: String,
    /// Write a UTF-8 BOM before `content`.
    #[serde(default)]
    pub bom: bool,
    /// The `mtime_ms` the editor loaded. A different value on disk is a conflict unless `force`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_mtime_ms: Option<u64>,
    /// The `size` the editor loaded, checked alongside the mtime for coarse-clock filesystems.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_size: Option<u64>,
    /// Overwrite (or recreate) the file even if it changed or disappeared on disk.
    #[serde(default)]
    pub force: bool,
}

/// Why a save was not written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictReason {
    Modified,
    Deleted,
}

/// The result of a save. A conflict is an expected outcome the editor resolves with the user, so it
/// is a value rather than an error string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TextFileSaveOutcome {
    Saved {
        size: u64,
        mtime_ms: u64,
    },
    Conflict {
        reason: ConflictReason,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        disk_mtime_ms: Option<u64>,
    },
}

#[cfg(test)]
#[path = "text_file_tests.rs"]
mod tests;
