//! Clean Up › Rust: the Cargo build folders (`target/`) under a set of roots, and freeing them.
//!
//! [`find_projects`] walks the roots for folders holding a `Cargo.toml` next to a `target/` that
//! Cargo made (it carries `CACHEDIR.TAG` or `.rustc_info.json`), without descending into build
//! output, `.git` or `node_modules`. [`measure_with`] sizes each build folder and the part of it
//! that is incremental-compilation cache. [`clean_with`] removes either that cache only (the next
//! build is a little slower) or the whole folder, like `cargo clean`. Links are never followed, and
//! a folder is re-checked to be a Cargo build folder right before anything in it is removed.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::parallel::{par_map, Tally};
pub use crate::parallel::{Progress, Step};
use crate::temp_cleanup::{measure, remove_tree};

#[cfg(test)]
#[path = "rust_cleanup_tests.rs"]
mod tests;

/// Folder names the project search never enters: build output, VCS data, JS dependencies.
const SKIPPED_DIRS: [&str; 4] = ["target", ".git", "node_modules", ".pnpm-store"];
/// How deep below a root the search looks for projects.
const MAX_DEPTH: usize = 8;
/// Folders the search reads at most per call, so a root like `C:\` cannot run for ever.
const MAX_DIRS_VISITED: usize = 200_000;

/// One Cargo project with a build folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RustTarget {
    /// The project folder (where `Cargo.toml` is).
    pub project: String,
    /// The project folder's name.
    pub name: String,
    pub target: String,
    pub files: u64,
    pub bytes: u64,
    /// Bytes of the incremental-compilation caches inside the build folder.
    pub incremental_bytes: u64,
    /// Seconds since the epoch of the last change in the build folder (its last build).
    pub last_build: u64,
}

/// What a clean-up removes from a build folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RustCleanMode {
    /// The incremental-compilation caches only.
    Incremental,
    /// The whole build folder (`cargo clean`).
    All,
}

/// What a clean-up did to one build folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RustCleanResult {
    pub target: String,
    pub freed_bytes: u64,
    /// The first reason part of it was kept (a running program locks its files).
    pub error: Option<String>,
}

/// Files and bytes under the folder `path`, links not followed; stops early once cancelled. Also
/// sizes worktrees for Clean Up › Worktrees.
pub fn folder_size(path: &Path, progress: &Progress<'_>) -> (u64, u64) {
    measure(path, true, 0, progress)
}

/// Whether `dir` is a build folder Cargo made, the only kind this module removes.
pub fn is_cargo_target(dir: &Path) -> bool {
    let real_dir = fs::symlink_metadata(dir).is_ok_and(|meta| meta.is_dir());
    real_dir && (dir.join("CACHEDIR.TAG").is_file() || dir.join(".rustc_info.json").is_file())
}

/// Project folders under `roots` that have a Cargo build folder, each once, in walk order.
pub fn find_projects(roots: &[PathBuf], progress: &Progress<'_>) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut visited = 0usize;
    for root in roots {
        let mut stack = vec![(root.clone(), 0usize)];
        while let Some((dir, depth)) = stack.pop() {
            if progress.cancelled() || visited >= MAX_DIRS_VISITED {
                return dedupe(found);
            }
            visited += 1;
            let Ok(children) = fs::read_dir(&dir) else {
                continue;
            };
            let mut subdirs = Vec::new();
            let mut has_manifest = false;
            for child in children.flatten() {
                let Ok(kind) = child.file_type() else {
                    continue;
                };
                let name = child.file_name();
                if kind.is_file() && name == "Cargo.toml" {
                    has_manifest = true;
                } else if kind.is_dir() && !SKIPPED_DIRS.iter().any(|skip| name == *skip) {
                    subdirs.push(child.path());
                }
            }
            if has_manifest && is_cargo_target(&dir.join("target")) {
                found.push(dir.clone());
            }
            if depth < MAX_DEPTH {
                stack.extend(subdirs.into_iter().map(|sub| (sub, depth + 1)));
            }
        }
    }
    dedupe(found)
}

fn dedupe(mut found: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    found.retain(|path| seen.insert(path.clone()));
    found
}

fn secs(time: SystemTime) -> u64 {
    time.duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

/// The incremental caches of a build folder: `<profile>/incremental` and, for a cross build,
/// `<triple>/<profile>/incremental`.
pub fn incremental_dirs(target: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let subdirs = |dir: &Path| -> Vec<PathBuf> {
        fs::read_dir(dir)
            .map(|children| {
                children
                    .flatten()
                    .filter(|child| child.file_type().is_ok_and(|kind| kind.is_dir()))
                    .map(|child| child.path())
                    .collect()
            })
            .unwrap_or_default()
    };
    for profile in subdirs(target) {
        let cache = profile.join("incremental");
        if cache.is_dir() {
            dirs.push(cache);
        } else {
            dirs.extend(
                subdirs(&profile)
                    .into_iter()
                    .map(|nested| nested.join("incremental"))
                    .filter(|nested| nested.is_dir()),
            );
        }
    }
    dirs
}

/// The newest change directly inside the build folder or its profile folders (a build touches
/// them), in seconds since the epoch.
fn last_build(target: &Path) -> u64 {
    let mut newest = fs::metadata(target)
        .and_then(|meta| meta.modified())
        .map_or(0, secs);
    if let Ok(children) = fs::read_dir(target) {
        for child in children.flatten() {
            if let Ok(time) = child.metadata().and_then(|meta| meta.modified()) {
                newest = newest.max(secs(time));
            }
        }
    }
    newest
}

/// Sizes the build folders of `projects`, the biggest first.
pub fn measure_with(projects: Vec<PathBuf>, progress: &Progress<'_>) -> Vec<RustTarget> {
    let total = projects.len() as u64;
    let tally = Tally::default();
    let mut targets = par_map(projects, |project| {
        let target = project.join("target");
        let (files, bytes) = measure(&target, true, 0, progress);
        let incremental_bytes = incremental_dirs(&target)
            .iter()
            .map(|dir| measure(dir, true, 0, progress).1)
            .sum();
        tally.finish(bytes, total, progress);
        RustTarget {
            name: project
                .file_name()
                .map_or_else(String::new, |name| name.to_string_lossy().into_owned()),
            project: project.to_string_lossy().into_owned(),
            target: target.to_string_lossy().into_owned(),
            files,
            bytes,
            incremental_bytes,
            last_build: last_build(&target),
        }
    });
    targets.sort_by(|a, b| {
        b.bytes
            .cmp(&a.bytes)
            .then_with(|| a.project.cmp(&b.project))
    });
    targets
}

/// Removes `mode`'s part of each build folder in `targets`. A folder that is no longer a Cargo
/// build folder is left untouched and reported.
pub fn clean_with(
    targets: Vec<PathBuf>,
    mode: RustCleanMode,
    progress: &Progress<'_>,
) -> Vec<RustCleanResult> {
    let total = targets.len() as u64;
    let tally = Tally::default();
    par_map(targets, |target| {
        let shown = target.to_string_lossy().into_owned();
        if !is_cargo_target(&target) {
            tally.finish(0, total, progress);
            return RustCleanResult {
                target: shown,
                freed_bytes: 0,
                error: Some("Not a Cargo build folder any more.".to_string()),
            };
        }
        let parts = match mode {
            RustCleanMode::Incremental => incremental_dirs(&target),
            RustCleanMode::All => vec![target.clone()],
        };
        let mut freed_bytes = 0;
        let mut error = None;
        for part in parts {
            let removal = remove_tree(&part, progress);
            freed_bytes += removal.freed;
            if error.is_none() {
                error = removal
                    .error
                    .map(|cause| format!("{}: {cause}", part.display()));
            }
        }
        tally.finish(freed_bytes, total, progress);
        RustCleanResult {
            target: shown,
            freed_bytes,
            error,
        }
    })
}
