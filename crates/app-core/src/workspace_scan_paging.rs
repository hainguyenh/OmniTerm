//! Bounded paging adapters for workspace scan results.

use super::{
    child_dirs, dir_entry, file_entry, in_deferred_subtree, scan_entries_excluding, scan_root,
    WorkspaceEntry, WorkspaceEntryPage,
};
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
///
/// A folder inside a deferred subtree (`node_modules`, `dist`, …) is not in the skeleton, so its
/// first page also carries its direct subfolders, each deferred in turn.
pub fn scan_folder_files_excluding(
    root: &Path,
    folder: &str,
    excluded: &[String],
    offset: usize,
    limit: usize,
) -> Result<WorkspaceEntryPage, String> {
    let root = scan_root(root);
    let dir = safepath::safe_subdir(&root.to_string_lossy(), folder, false)?;
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
    let subfolders = if offset == 0 && in_deferred_subtree(folder) {
        child_dirs(&dir)
            .into_iter()
            .map(|(name, path)| dir_entry(&root, &path, name, true))
            .collect()
    } else {
        Vec::new()
    };
    Ok(WorkspaceEntryPage {
        entries: files.get(offset..end).unwrap_or_default().to_vec(),
        total,
        has_more: end < total,
        subfolders,
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
        subfolders: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn pages_folder_files_and_entries() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("scripts");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("a.sh"), "echo a\n").unwrap();
        std::fs::write(sub.join("b.sh"), "echo b\n").unwrap();

        let page1 = scan_folder_files_excluding(dir.path(), "scripts", &[], 0, 1).unwrap();
        assert_eq!(page1.total, 2);
        assert_eq!(page1.entries.len(), 1);
        assert!(page1.has_more);

        let page_all = scan_entries_page_excluding(dir.path(), &[], 0, 10);
        assert_eq!(page_all.total, 3);
        assert!(!page_all.has_more);
    }

    #[test]
    fn folder_pages_are_direct_sorted_bounded_and_respect_view_exclusions() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("scripts");
        std::fs::create_dir_all(sub.join("nested")).unwrap();
        std::fs::write(sub.join("z.txt"), "z").unwrap();
        std::fs::write(sub.join("a.sh"), "echo a").unwrap();
        std::fs::write(sub.join("nested/hidden.sh"), "echo hidden").unwrap();

        let page = scan_folder_files_excluding(dir.path(), "scripts", &["txt".to_string()], 0, 10)
            .unwrap();
        assert_eq!(
            page.total, 2,
            "nested files belong to the nested folder's page"
        );
        assert_eq!(page.entries[0].id, "scripts/a.sh");
        assert_eq!(page.entries[1].id, "scripts/z.txt");
        assert_eq!(page.entries[1].viewable, Some(false));
        assert!(!page.has_more);

        let empty = scan_folder_files_excluding(dir.path(), "scripts", &[], 1, 0).unwrap();
        assert!(empty.entries.is_empty());
        assert!(empty.has_more);
        let past_end =
            scan_folder_files_excluding(dir.path(), "scripts", &[], usize::MAX, 5).unwrap();
        assert!(past_end.entries.is_empty());
        assert!(!past_end.has_more);
    }

    #[test]
    fn missing_and_hostile_folder_pages_are_handled_without_escaping_the_root() {
        let dir = tempdir().unwrap();
        assert!(scan_folder_files_excluding(dir.path(), "missing", &[], 0, 10).is_err());
        assert!(scan_folder_files_excluding(dir.path(), "../outside", &[], 0, 10).is_err());
        assert!(scan_folder_files_excluding(dir.path(), "/tmp", &[], 0, 10).is_err());
    }

    #[test]
    fn full_entry_paging_handles_zero_and_out_of_range_windows() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "a").unwrap();
        std::fs::write(dir.path().join("b.txt"), "b").unwrap();

        let zero = scan_entries_page_excluding(dir.path(), &[], 0, 0);
        assert_eq!(zero.total, 2);
        assert!(zero.entries.is_empty());
        assert!(zero.has_more);

        let beyond = scan_entries_page_excluding(dir.path(), &[], 99, usize::MAX);
        assert!(beyond.entries.is_empty());
        assert!(!beyond.has_more);
    }

    /// A deferred folder's subfolders are not in the skeleton, so its first page carries them — each
    /// deferred in turn — while later pages and skeleton folders carry none.
    #[test]
    fn deferred_folder_pages_carry_their_subfolders() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let touch = |rel: &str| {
            let path = root.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "").unwrap();
        };
        touch("node_modules/left-pad/index.js");
        touch("node_modules/.bin/tool");
        touch("node_modules/.git/HEAD");
        touch("node_modules/a.txt");
        touch("node_modules/b.txt");
        touch("src/lib/x.ts");

        let first = scan_folder_files_excluding(root, "node_modules", &[], 0, 1).unwrap();
        let subs: Vec<_> = first.subfolders.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(subs, vec!["node_modules/.bin", "node_modules/left-pad"]);
        assert!(first
            .subfolders
            .iter()
            .all(|e| e.is_dir && e.deferred == Some(true)));
        assert_eq!(first.total, 2);

        let second = scan_folder_files_excluding(root, "node_modules", &[], 1, 1).unwrap();
        assert!(
            second.subfolders.is_empty(),
            "only the first page lists subfolders"
        );

        let nested =
            scan_folder_files_excluding(root, "node_modules/left-pad", &[], 0, 10).unwrap();
        assert!(nested.subfolders.is_empty());
        assert_eq!(nested.entries[0].id, "node_modules/left-pad/index.js");

        let skeleton = scan_folder_files_excluding(root, "src", &[], 0, 10).unwrap();
        assert!(
            skeleton.subfolders.is_empty(),
            "skeleton folders already know their subfolders"
        );
    }
}
