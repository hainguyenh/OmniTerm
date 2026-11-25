//! Files inside the folders a project search skips (`.gitignore`d build output,
//! dependency trees, generated folders), found by name for Search Everywhere's
//! "Include non-project items".

use crate::ScopeFile;
use crate::engine::{rel_path, walk_files};
use ide_core::CancellationToken;
use ignore::WalkState;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};

/// Stop listing after this many files: a huge `node_modules` must not stall the popup.
const MAX_VISITED: usize = 300_000;

/// How well `rel` (lowercase, `/`-separated) matches `needle` (lowercase, no spaces):
/// lower is better, `None` when it does not match at all.
fn rank(rel: &str, needle: &str) -> Option<u8> {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    if name == needle {
        Some(0)
    } else if name.starts_with(needle) {
        Some(1)
    } else if name.contains(needle) {
        Some(2)
    } else if rel.contains(needle) {
        Some(3)
    } else if is_subsequence(name, needle) {
        Some(4)
    } else {
        None
    }
}

fn is_subsequence(text: &str, needle: &str) -> bool {
    let mut chars = text.chars();
    needle.chars().all(|c| chars.any(|t| t == c))
}

/// The directories a normal project walk visits (`.gitignore`d folders left out).
fn walked_dirs(roots: &[PathBuf], cancel: &CancellationToken) -> HashSet<PathBuf> {
    let dirs = Mutex::new(HashSet::new());
    walk_files(roots, false, || {
        let dirs = &dirs;
        Box::new(move |path: &Path| {
            if cancel.is_cancelled() {
                return WalkState::Quit;
            }
            if let Some(parent) = path.parent() {
                dirs.lock().unwrap_or_else(|e| e.into_inner()).insert(parent.to_path_buf());
            }
            WalkState::Continue
        })
    });
    dirs.into_inner().unwrap_or_else(|e| e.into_inner())
}

/// Up to `limit` files under `root` that only a walk including ignored folders
/// reaches, whose name or relative path matches `query` (case-insensitive; a
/// name match ranks first, then a scattered-letters match), best first. `.git`
/// is never entered. Returns what was found so far when cancelled.
pub fn ignored_files(root: &Path, query: &str, limit: usize, cancel: &CancellationToken) -> Vec<ScopeFile> {
    let needle: String = query.chars().filter(|c| !c.is_whitespace()).flat_map(char::to_lowercase).collect();
    let needle = needle.replace('\\', "/");
    if needle.is_empty() || limit == 0 || !root.is_dir() {
        return Vec::new();
    }
    let roots = [root.to_path_buf()];
    let walked = walked_dirs(&roots, cancel);
    let visited = AtomicUsize::new(0);
    let found = Mutex::new(Vec::new());
    walk_files(&roots, true, || {
        let (walked, visited, found, needle) = (&walked, &visited, &found, &needle);
        Box::new(move |path: &Path| {
            if cancel.is_cancelled() || visited.fetch_add(1, Relaxed) >= MAX_VISITED {
                return WalkState::Quit;
            }
            if path.parent().is_some_and(|dir| walked.contains(dir)) {
                return WalkState::Continue;
            }
            let rel = rel_path(root, path);
            if let Some(score) = rank(&rel.to_lowercase(), needle) {
                found
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .push((score, ScopeFile { path: path.to_path_buf(), rel_path: rel }));
            }
            WalkState::Continue
        })
    });
    let mut found = found.into_inner().unwrap_or_else(|e| e.into_inner());
    found.sort_by(|(a, fa), (b, fb)| {
        a.cmp(b).then_with(|| fa.rel_path.len().cmp(&fb.rel_path.len())).then_with(|| fa.rel_path.cmp(&fb.rel_path))
    });
    found.into_iter().take(limit).map(|(_, file)| file).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = dir.path();
        for (path, text) in [
            (".gitignore", "build/\nreviews/\n.env\n"),
            ("src/handoff.rs", "a"),
            ("build/out/handoff.js", "b"),
            ("reviews/56070-[Handoff]-service.md", "c"),
            (".env", "d"),
        ] {
            let path = root.join(path);
            std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
            std::fs::write(path, text).expect("write");
        }
        dir
    }

    fn rels(files: Vec<ScopeFile>) -> Vec<String> {
        files.into_iter().map(|f| f.rel_path).collect()
    }

    #[test]
    fn finds_only_files_in_ignored_folders() {
        let dir = tree();
        let cancel = CancellationToken::new();
        // `src/handoff.rs` is a project file and `.env` an ignored file the project walk lists:
        // only the files under the ignored folders come back, name matches first.
        assert_eq!(
            rels(ignored_files(dir.path(), "handoff", 10, &cancel)),
            vec!["build/out/handoff.js", "reviews/56070-[Handoff]-service.md"]
        );
        assert_eq!(
            rels(ignored_files(dir.path(), "reviews/56070", 10, &cancel)),
            vec!["reviews/56070-[Handoff]-service.md"]
        );
        assert_eq!(rels(ignored_files(dir.path(), "HndSrv", 10, &cancel)), vec!["reviews/56070-[Handoff]-service.md"]);
        assert!(ignored_files(dir.path(), "handoff", 1, &cancel).len() == 1);
        assert!(ignored_files(dir.path(), "  ", 10, &cancel).is_empty());
    }

    #[test]
    fn ranks_names_before_paths_and_scattered_letters() {
        assert_eq!(rank("a/handoff.md", "handoff.md"), Some(0));
        assert_eq!(rank("a/handoff.md", "hand"), Some(1));
        assert_eq!(rank("a/x-handoff.md", "handoff"), Some(2));
        assert_eq!(rank("handoff/x.md", "handoff"), Some(3));
        assert_eq!(rank("a/handoff.md", "hdf"), Some(4));
        assert_eq!(rank("a/handoff.md", "zzz"), None);
    }
}
