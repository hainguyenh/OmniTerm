//! Merging a pane's temporary attachment folder into its agent session's folder, once the agent's
//! session id is known (see `attachments`).

use crate::attachments::{list_attachments, split_extension};
use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[cfg(test)]
#[path = "attachment_move_tests.rs"]
mod tests;

/// Where one attachment went when its folder was merged into another.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MovedAttachment {
    pub from: String,
    pub to: String,
}

/// Move every file of `from` (a pane's temporary folder) into `to` (its agent session's folder),
/// keeping names and never overwriting: a name already taken gets a `-<n>` suffix. The emptied
/// `from` tree is removed. A file that cannot be moved stays where it is and is not reported.
pub fn move_attachments(from: &Path, to: &Path) -> io::Result<Vec<MovedAttachment>> {
    if from == to {
        return Ok(Vec::new());
    }
    let files = list_attachments(from);
    if files.is_empty() {
        return Ok(Vec::new());
    }
    fs::create_dir_all(to)?;
    let mut moved = Vec::new();
    for info in files {
        let source = PathBuf::from(&info.path);
        let (stem, extension) = split_extension(&info.name);
        let mut target = to.join(&info.name);
        let mut counter = 1;
        while target.exists() {
            let suffix = if extension.is_empty() {
                String::new()
            } else {
                format!(".{extension}")
            };
            target = to.join(format!("{stem}-{counter}{suffix}"));
            counter += 1;
        }
        if fs::rename(&source, &target).is_ok() {
            moved.push(MovedAttachment {
                from: info.path,
                to: target.to_string_lossy().into_owned(),
            });
        }
    }
    // Only succeeds once empty; a leftover (unmovable) file keeps its folder.
    let _ = fs::remove_dir(from);
    Ok(moved)
}
