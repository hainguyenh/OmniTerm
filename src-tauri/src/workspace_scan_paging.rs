//! Bounded paging adapters for workspace scan results.

use super::{file_entry, scan_entries_excluding, scan_root, WorkspaceEntry, WorkspaceEntryPage};
use crate::safepath;
use std::fs;
use std::path::Path;

/// One page of the files directly under one folder — what the panel's folder-level "Show more" row
/// asks for.
///
/// `folder` is the folder's POSIX-relative path inside the workspace (`""` = the workspace root),
/// validated by `safepath::safe_subdir` so a hostile value cannot escape the workspace. Only the
/// folder's own files are listed — subdirectories are owned by the skeleton (`scan_folders`), and
/// the listing never descends, so an ignored directory below is simply never visited. The files are
/// sorted by `id`, so the same `offset` names the same files on every call.
pub fn scan_folder_files_excluding(
    root: &Path,
    folder: &str,
    excluded: &[String],
    offset: usize,
    limit: usize,
) -> Result<WorkspaceEntryPage, String> {
    let root = scan_root(root);
    let dir = safepath::safe_subdir(&root.to_string_lossy(), folder)?;
    let mut files: Vec<WorkspaceEntry> = Vec::new();
    if let Ok(read) = fs::read_dir(&dir) {
        for entry in read.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_file() {
                files.push(file_entry(&root, &entry.path(), excluded));
            }
        }
    }
    files.sort_by(|a, b| a.id.cmp(&b.id));
    let total = files.len();
    let end = offset.saturating_add(limit).min(total);
    Ok(WorkspaceEntryPage {
        entries: files.get(offset..end).unwrap_or_default().to_vec(),
        total,
        has_more: end < total,
    })
}

/// One page of `scan_entries_excluding`, kept for completeness (and its tests) now that the panel
/// pages per folder instead: the walk is deterministic (each directory is read in sorted order), so
/// the same `offset` names the same files on every call.
pub fn scan_entries_page_excluding(
    root: &Path,
    excluded: &[String],
    offset: usize,
    limit: usize,
) -> WorkspaceEntryPage {
    let all = scan_entries_excluding(root, excluded);
    let total = all.len();
    let end = offset.saturating_add(limit).min(total);
    WorkspaceEntryPage {
        entries: all.get(offset..end).unwrap_or_default().to_vec(),
        total,
        has_more: end < total,
    }
}
