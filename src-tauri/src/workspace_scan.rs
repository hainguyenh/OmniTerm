//! The workspace scan: what a pinned project folder contains, bounded per page, never silently
//! truncated.
//!
//! Split out of workspace.rs (which owns the persisted workspace list and the run/read/write
//! commands) once the scan grew a second view of the same walk: `scan_entries` describes *everything*
//! — every directory and every file — for the panel's folder tree and its type filter, and `scan_dir`
//! is the runnables-only filter over it. Keeping them in one module is what guarantees the two views
//! can never disagree about what is in a folder.
//!
//! A workspace can hold tens of thousands of files, so the full-entry view is *paged per folder*:
//! `scan_folders` ships the whole directory skeleton up front (folders are a small fraction of a
//! workspace's entries, and the panel shows every folder before any of its files), and
//! `scan_folder_files_excluding` pages one folder's direct files at a time. The tree grows as the
//! user expands folders or clicks a folder's "Show more" row, which keeps both the IPC payload and
//! the DOM bounded without ever hiding files the user asked to see.
//!
//! Ports electron/services/workspaceScan.ts.

use crate::safepath;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(test)]
#[path = "workspace_scan_tests.rs"]
mod tests;

/// Directories never descended into — noise or huge, and never where user scripts live.
/// Applies to both views: these are *skipped*, not paged, because nobody has ever wanted to browse
/// `node_modules` from a script launcher.
const IGNORE_DIRS: [&str; 13] = [
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "dist",
    "build",
    "out",
    ".next",
    ".turbo",
    ".cache",
    "coverage",
    "vendor",
    "__pycache__",
];

const MAX_SCRIPTS: usize = 500;
/// Default entries per `scan_workspace_entries` call — the page the renderer asks for, and what one
/// folder's tree grows by with each "Show more" click. Kept bounded (it used to be a hard scan cap
/// that silently dropped everything past it) so a huge folder never ships a 30k-entry payload.
pub const DEFAULT_PAGE_SIZE: usize = 2000;
/// Server-side clamp on the page size: the renderer picks the page, so a hostile value must not
/// balloon the IPC payload.
pub const MAX_PAGE_SIZE: usize = 10_000;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceScript {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editable: Option<bool>,
    /// Whether the viewer will show this file's contents as text. Wider than `editable`: a `.txt`,
    /// a `.json` or a `.rdp` is viewable but not saveable. `None` for directories.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewable: Option<bool>,
}

/// One thing found inside a workspace: a directory, a runnable script, or any other file.
///
/// A superset of `WorkspaceScript` — the Workspace panel renders the *whole* folder tree and filters
/// it client-side (folders + scripts by default, all files or a chosen set of types on request), so
/// one scan has to describe everything rather than only what is runnable.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    /// POSIX-style path relative to the workspace root — stable across scans, and what a
    /// workspace connection stores in `parentId` to say which folder it belongs to.
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// `dir` for a directory; otherwise the script kind from `classify`, else the lowercased
    /// extension, else `file` for an extensionless one.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editable: Option<bool>,
    /// Whether the viewer will show this file's contents as text — see `WorkspaceScript::viewable`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewable: Option<bool>,
}

/// One page of a folder's files.
///
/// The listing walks that one folder only (no recursion), so `total` and the page slice are exact
/// and `has_more` is truthful — "Show more" never chases a moving offset.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntryPage {
    pub entries: Vec<WorkspaceEntry>,
    /// How many files the folder holds — what the "Show more (N remaining)" row counts down.
    pub total: usize,
    pub has_more: bool,
}

/// The kinds `classify` can produce — i.e. the entries that are runnable.
const SCRIPT_KINDS: [&str; 4] = ["bat", "ps1", "sh", "rdp"];

impl WorkspaceEntry {
    /// The runnable view of this entry, or `None` if it is a directory or a non-script file.
    fn as_script(&self) -> Option<WorkspaceScript> {
        if self.is_dir || !SCRIPT_KINDS.contains(&self.kind.as_str()) {
            return None;
        }
        Some(WorkspaceScript {
            id: self.id.clone(),
            name: self.name.clone(),
            path: self.path.clone(),
            kind: self.kind.clone(),
            shell: self.shell.clone(),
            editable: self.editable,
            viewable: self.viewable,
        })
    }
}

/// Map a file extension to a kind, the shell best suited to run it, and whether it is editable text.
///
/// `.cmd` classifies as kind `bat` (not `cmd`): the renderer and the run dispatcher both switch on
/// `kind`, so emitting the raw extension — as the first port did — sent `.cmd` files down an
/// unhandled branch.
fn classify(ext: &str) -> Option<(&'static str, Option<&'static str>, bool)> {
    match ext.to_lowercase().as_str() {
        "bat" | "cmd" => Some(("bat", Some("cmd"), true)),
        "ps1" => Some(("ps1", Some("powershell"), true)),
        "sh" => Some(("sh", Some("wsl"), true)),
        "rdp" => Some(("rdp", None, false)),
        _ => None,
    }
}

/// Shallow, bounded scan for runnable scripts. Each script's `id` is its POSIX-style path relative
/// to the root — stable across scans, unlike the random UUID the first port generated, which made
/// every rescan look like an entirely new set of scripts to the renderer.
///
/// A filter over `scan_entries`, so the two views of a workspace can never disagree about what is in
/// it. Still capped at `MAX_SCRIPTS` — its callers page nothing.
pub fn scan_dir(root: &Path) -> Vec<WorkspaceScript> {
    scan_dir_excluding(root, &[])
}

/// Same as `scan_dir`, additionally marking the user's own excluded extensions as not viewable.
pub fn scan_dir_excluding(root: &Path, excluded: &[String]) -> Vec<WorkspaceScript> {
    scan_entries_excluding(root, excluded)
        .iter()
        .filter_map(WorkspaceEntry::as_script)
        .take(MAX_SCRIPTS)
        .collect()
}

/// Shallow, bounded scan of everything in a workspace: every directory (including ones with no
/// scripts in them) and every file. Sorted by `id`, so parents always precede their children.
///
/// Not bounded the way it used to be — the old `MAX_ENTRIES` cap made "All files" silently stop at
/// 2000 entries, which on a real project is usually the build output, not the source. The renderer
/// pages instead (see `scan_entries_page_excluding`).
pub fn scan_entries(root: &Path) -> Vec<WorkspaceEntry> {
    scan_entries_excluding(root, &[])
}

/// Same as `scan_entries`, additionally marking the user's own excluded extensions as not viewable —
/// `excluded` is the "Excluded file types" setting (GeneralSettings.tsx), layered on top of the fixed
/// `VIEW_DENY_EXTS` gate so the scan's `viewable` flag stays in step with what `read_script` will
/// actually allow.
pub fn scan_entries_excluding(root: &Path, excluded: &[String]) -> Vec<WorkspaceEntry> {
    let root = scan_root(root);
    let mut found: Vec<WorkspaceEntry> = Vec::new();
    walk(&root, &root, &mut found, excluded);
    found.sort_by(|a, b| a.id.cmp(&b.id));
    found
}

/// Every directory in a workspace — the tree's *skeleton*. Sorted by `id` so parents precede their
/// children, exactly like the full scan.
///
/// Not paged: directories are a small fraction of a workspace's entries (a 30k-file project has a
/// few hundred folders), and the panel must show every folder up front before any of their files.
/// Hidden directories are reported like everything else — "All files" really means all files.
pub fn scan_folders(root: &Path) -> Vec<WorkspaceEntry> {
    let root = scan_root(root);
    let mut found: Vec<WorkspaceEntry> = Vec::new();
    collect_folders(&root, &root, &mut found);
    found.sort_by(|a, b| a.id.cmp(&b.id));
    found
}

fn collect_folders(root: &Path, dir: &Path, found: &mut Vec<WorkspaceEntry>) {
    // An unreadable subdirectory is skipped rather than aborting the whole scan.
    let Ok(mut entries) = fs::read_dir(dir).map(|it| it.flatten().collect::<Vec<_>>()) else {
        return;
    };
    // Deterministic order: read_dir's order is filesystem-defined, and the ids must be stable.
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || IGNORE_DIRS.contains(&name.to_lowercase().as_str()) {
            continue;
        }
        found.push(WorkspaceEntry {
            id: rel_id(root, &path),
            name,
            path: path.to_string_lossy().into_owned(),
            is_dir: true,
            kind: "dir".to_string(),
            shell: None,
            editable: None,
            viewable: None,
        });
        collect_folders(root, &path, found);
    }
}

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

/// The entry for one file: kind from `classify`, extension as kind for everything else, and the
/// viewer's `viewable` flag decided from the extension — shared by the full walk and the per-folder
/// listing so the two views can never disagree about a file.
fn file_entry(root: &Path, path: &Path, excluded: &[String]) -> WorkspaceEntry {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_default();
    // A non-script file still gets an entry: it is filtered out of the default view by the
    // renderer, not by the scan, so switching the filter needs no rescan.
    let (kind, shell, editable) = match classify(&ext) {
        Some((kind, shell, editable)) => (kind.to_string(), shell.map(str::to_owned), Some(editable)),
        None if ext.is_empty() => ("file".to_string(), None, None),
        None => (ext.to_lowercase(), None, None),
    };
    // Decided from the extension, not the file's bytes: the scan must not open files. `read_viewable`
    // still sniffs the content when the user actually opens the file, so a binary wearing a text
    // extension is caught there — this flag only decides whether the viewer offers to try.
    WorkspaceEntry {
        id: rel_id(root, path),
        name,
        path: path.to_string_lossy().into_owned(),
        is_dir: false,
        kind,
        shell,
        editable,
        viewable: Some(safepath::is_viewable_kind_excluding(&ext, excluded)),
    }
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

/// POSIX-style path of `path` relative to `root`.
fn rel_id(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// The workspace root in the form `safe_subdir` resolves it to, so every view of the scan strips
/// ids against the same bytes. A pinned path can differ from its canonical form (`..`, a symlink, an
/// 8.3 short name), and the per-folder page canonicalizes internally — without this, its entries
/// would come back with absolute ids and paths that disagree with the full walk's.
fn scan_root(root: &Path) -> PathBuf {
    safepath::canonical(root).unwrap_or_else(|_| root.to_path_buf())
}

fn walk(root: &Path, dir: &Path, found: &mut Vec<WorkspaceEntry>, excluded: &[String]) {
    // An unreadable subdirectory is skipped rather than aborting the whole scan.
    let Ok(mut entries) = fs::read_dir(dir).map(|it| it.flatten().collect::<Vec<_>>()) else {
        return;
    };
    // Deterministic order: read_dir's order is filesystem-defined, and paging needs a stable walk —
    // the same offset has to name the same files on every call.
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            // Ignored directories are skipped outright; hidden directories (`.vscode`, `.idea`) are
            // reported like everything else — "All files" really means all files.
            if IGNORE_DIRS.contains(&name.to_lowercase().as_str()) {
                continue;
            }
            found.push(WorkspaceEntry {
                id: rel_id(root, &path),
                name,
                path: path.to_string_lossy().into_owned(),
                is_dir: true,
                kind: "dir".to_string(),
                shell: None,
                editable: None,
                viewable: None,
            });
            walk(root, &path, found, excluded);
        } else if file_type.is_file() {
            found.push(file_entry(root, &path, excluded));
        }
    }
}
