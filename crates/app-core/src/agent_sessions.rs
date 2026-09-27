//! Crash-safe store for the renderer's resumable agent sessions and bookmarks.
//!
//! The renderer keeps these in localStorage, which WebView2 flushes lazily: when the app is killed
//! outright, the last few seconds of writes (exactly the "Claude session X runs in pane 1" state
//! that resume needs) can be lost. This file is the durable copy. It is written atomically — a
//! temp file renamed over the old one — so a kill mid-write leaves the previous version intact
//! rather than a truncated document.
//!
//! The document is opaque here: the renderer validates every entry it reads back, because a stored
//! value can end up in a resume command. This module only bounds its size and shape.

use serde_json::Value;
use std::fs;
use std::io::{self, Write};
use std::path::Path;

#[cfg(test)]
#[path = "agent_sessions_tests.rs"]
mod tests;

/// Far above what 20 sessions, 100 bookmarks and 50 pins take; anything larger is not ours.
pub const MAX_STORE_BYTES: usize = 512 * 1024;

/// The stored document, or `None` when the file is missing, unreadable, oversized or not a JSON
/// object. Losing the durable copy is recoverable (localStorage still has most of it); refusing to
/// start over a corrupt file is not.
pub fn load_store(path: &Path) -> Option<Value> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > MAX_STORE_BYTES as u64 {
        return None;
    }
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str::<Value>(&text)
        .ok()
        .filter(Value::is_object)
}

/// Replace the stored document atomically. Rejects anything that is not a JSON object or that
/// exceeds [`MAX_STORE_BYTES`] once serialized.
pub fn save_store(path: &Path, document: &Value) -> io::Result<()> {
    if !document.is_object() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "agent session store must be a JSON object",
        ));
    }
    let contents = serde_json::to_vec(document)?;
    if contents.len() > MAX_STORE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "agent session store is too large",
        ));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension("json.tmp");
    {
        let mut file = fs::File::create(&temp)?;
        file.write_all(&contents)?;
        file.sync_all()?;
    }
    // `rename` replaces an existing destination on every supported platform (MoveFileExW with
    // MOVEFILE_REPLACE_EXISTING on Windows), so readers see either the old or the new document.
    fs::rename(&temp, path).inspect_err(|_| {
        let _ = fs::remove_file(&temp);
    })
}
