//! The workspace scan: what a pinned project folder contains, bounded and shallow.
//!
//! Split out of workspace.rs (which owns the persisted workspace list and the run/read/write
//! commands) once the scan grew a second view of the same walk: `scan_entries` describes *everything*
//! — every directory and every file — for the panel's folder tree and its type filter, and `scan_dir`
//! is the runnables-only filter over it. Keeping them in one module is what guarantees the two views
//! can never disagree about what is in a folder.
//!
//! Ports electron/services/workspaceScan.ts.

use crate::safepath;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[cfg(test)]
#[path = "workspace_scan_tests.rs"]
mod tests;

/// Directories never descended into — noise or huge, and never where user scripts live.
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

const MAX_DEPTH: usize = 3;
const MAX_SCRIPTS: usize = 500;
/// Bound for the full entry scan (every directory + every file, not just runnables). Higher than
/// `MAX_SCRIPTS` because it counts everything a project folder contains, and the renderer filters
/// client-side so a rescan is not needed each time the user changes the filter.
const MAX_ENTRIES: usize = 2000;
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
pub fn scan_entries(root: &Path) -> Vec<WorkspaceEntry> {
    scan_entries_excluding(root, &[])
}

/// Same as `scan_entries`, additionally marking the user's own excluded extensions as not viewable —
/// `excluded` is the "Excluded file types" setting (GeneralSettings.tsx), layered on top of the fixed
/// `VIEW_DENY_EXTS` gate so the scan's `viewable` flag stays in step with what `read_script` will
/// actually allow.
pub fn scan_entries_excluding(root: &Path, excluded: &[String]) -> Vec<WorkspaceEntry> {
    let mut found: Vec<WorkspaceEntry> = Vec::new();
    walk(root, root, 0, &mut found, excluded);
    found.sort_by(|a, b| a.id.cmp(&b.id));
    found
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

fn walk(root: &Path, dir: &Path, depth: usize, found: &mut Vec<WorkspaceEntry>, excluded: &[String]) {
    if depth > MAX_DEPTH || found.len() >= MAX_ENTRIES {
        return;
    }
    // An unreadable subdirectory is skipped rather than aborting the whole scan.
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        if found.len() >= MAX_ENTRIES {
            return;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            if name.starts_with('.') || IGNORE_DIRS.contains(&name.to_lowercase().as_str()) {
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
            walk(root, &path, depth + 1, found, excluded);
        } else if file_type.is_file() {
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().into_owned())
                .unwrap_or_default();
            // A non-script file still gets an entry: it is filtered out of the default view by the
            // renderer, not by the scan, so switching the filter needs no rescan.
            let (kind, shell, editable) = match classify(&ext) {
                Some((kind, shell, editable)) => {
                    (kind.to_string(), shell.map(str::to_owned), Some(editable))
                }
                None if ext.is_empty() => ("file".to_string(), None, None),
                None => (ext.to_lowercase(), None, None),
            };
            // Decided from the extension, not the file's bytes: the scan walks up to 2000 entries and
            // must not open any of them. `read_viewable` still sniffs the content when the user
            // actually opens the file, so a binary wearing a text extension is caught there — this
            // flag only decides whether the viewer offers to try.
            let viewable = safepath::is_viewable_kind_excluding(&ext, excluded);
            found.push(WorkspaceEntry {
                id: rel_id(root, &path),
                name,
                path: path.to_string_lossy().into_owned(),
                is_dir: false,
                kind,
                shell,
                editable,
                viewable: Some(viewable),
            });
        }
    }
}
