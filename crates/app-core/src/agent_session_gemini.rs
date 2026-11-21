//! Antigravity (agy) conversations on disk.
//!
//! Antigravity keeps one database per conversation:
//! `<profile>/conversations/<uuid>.db` (`.pb` in older versions), with the same UUID naming its
//! `brain/<uuid>/` folder, `annotations/<uuid>.pbtxt` and `presence/<uuid>.lock`.

use std::path::{Path, PathBuf};

use super::{regular_files, SessionRoot};
use crate::agent_session_header::is_uuid;

#[cfg(test)]
#[path = "agent_session_gemini_tests.rs"]
mod tests;

fn has_extension(path: &Path, extensions: &[&str]) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| extensions.contains(&ext))
}

fn stem(path: &Path) -> Option<&str> {
    path.file_stem()?.to_str()
}

/// Every Antigravity conversation of the profile: a database named after its UUID. A conversation
/// kept in both formats is listed once, by its database.
pub(super) fn agy_conversations(root: &SessionRoot) -> Vec<PathBuf> {
    let files = regular_files(&root.dir.join("conversations"));
    let has_db = |id: &str| {
        files
            .iter()
            .any(|other| stem(other) == Some(id) && has_extension(other, &["db"]))
    };
    files
        .iter()
        .filter(|path| {
            stem(path).is_some_and(|id| {
                is_uuid(id)
                    && (has_extension(path, &["db"])
                        || (has_extension(path, &["pb"]) && !has_db(id)))
            })
        })
        .cloned()
        .collect()
}

/// What Antigravity keeps beside a conversation's database under the same (UUID) id: the other
/// format, SQLite's side files, its brain folder, annotations and presence lock.
pub(super) fn agy_companions(root: &SessionRoot, id: &str) -> Vec<PathBuf> {
    let conversations = root.dir.join("conversations");
    let mut paths: Vec<PathBuf> = ["db", "pb", "db-wal", "db-shm", "db-journal"]
        .iter()
        .map(|ext| conversations.join(format!("{id}.{ext}")))
        .collect();
    paths.push(root.dir.join("brain").join(id));
    paths.push(root.dir.join("annotations").join(format!("{id}.pbtxt")));
    paths.push(root.dir.join("presence").join(format!("{id}.lock")));
    paths
}
