//! Gemini CLI and Antigravity (agy) conversations on disk.
//!
//! Gemini CLI writes one file per conversation: `~/.gemini/tmp/<project>/chats/session-*.jsonl`
//! (`.json` in older versions), and the project folder's `.project_root` names its working
//! directory. Antigravity keeps one database per conversation:
//! `<profile>/conversations/<uuid>.db` (`.pb` in older versions), with the same UUID naming its
//! `brain/<uuid>/` folder, `annotations/<uuid>.pbtxt` and `presence/<uuid>.lock`.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use super::{real_subdirs, regular_files, SessionRoot};
use crate::agent_session_header::is_uuid;

#[cfg(test)]
#[path = "agent_session_gemini_tests.rs"]
mod tests;

/// `.project_root` holds one path; anything longer is not one.
const PROJECT_ROOT_BYTES: u64 = 4096;

fn has_extension(path: &Path, extensions: &[&str]) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| extensions.contains(&ext))
}

fn stem(path: &Path) -> Option<&str> {
    path.file_stem()?.to_str()
}

/// Every Gemini CLI chat file of the profile, one per conversation.
pub(super) fn gemini_chats(root: &SessionRoot) -> Vec<PathBuf> {
    real_subdirs(&root.dir.join("tmp"))
        .iter()
        .flat_map(|project| regular_files(&project.join("chats")))
        .filter(|path| {
            stem(path).is_some_and(|name| name.starts_with("session-"))
                && has_extension(path, &["json", "jsonl"])
        })
        .collect()
}

/// The working directory of a Gemini CLI chat: its project folder's `.project_root`.
pub(super) fn gemini_project_dir(chat: &Path) -> Option<String> {
    let file = chat.parent()?.parent()?.join(".project_root");
    if !fs::symlink_metadata(&file).is_ok_and(|meta| meta.is_file()) {
        return None;
    }
    let mut text = String::new();
    fs::File::open(&file)
        .ok()?
        .take(PROJECT_ROOT_BYTES)
        .read_to_string(&mut text)
        .ok()?;
    let path = text.trim();
    (!path.is_empty() && !path.contains('\n')).then(|| path.to_string())
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
