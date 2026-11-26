//! IPC for Clean Up › Worktrees. A removal only accepts worktrees the last scan reported, and runs
//! `git worktree remove` in their repository (`--force` only when the user confirmed losing
//! uncommitted changes) or `git worktree prune` for one whose folder is already gone. A merged
//! branch is deleted only after checking again that its tip is on the main-line branch.

use app_core::rust_cleanup::Progress;
use ide_vcs::Repo;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Runtime};

use crate::cleanup_progress::ProgressEmitter;
use crate::worktree_cleanup::{scan, WorktreeEntry};

#[cfg(test)]
#[path = "worktree_cleanup_tests.rs"]
mod tests;

const PROGRESS_EVENT: &str = "worktree-cleanup:progress";

static CANCEL: AtomicBool = AtomicBool::new(false);

/// What a removal needs about a worktree the last scan reported, by its path.
#[derive(Debug, Clone)]
struct Known {
    repo: PathBuf,
    path: PathBuf,
    branch: Option<String>,
    base: Option<String>,
    missing: bool,
}

static SCANNED: Mutex<Option<HashMap<String, Known>>> = Mutex::new(None);

fn with_scanned<T>(f: impl FnOnce(&mut HashMap<String, Known>) -> T) -> T {
    let mut guard = SCANNED
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    f(guard.get_or_insert_with(HashMap::new))
}

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveFailure {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRemoveReport {
    pub removed: Vec<String>,
    pub deleted_branches: Vec<String>,
    /// Merged branches left in place, with why.
    pub kept_branches: Vec<RemoveFailure>,
    pub failed: Vec<RemoveFailure>,
}

/// The linked worktrees of the repositories under the workspaces and `extra_roots`.
#[tauri::command]
pub async fn worktree_cleanup_scan<R: Runtime>(
    app: AppHandle<R>,
    extra_roots: Vec<String>,
) -> Result<Vec<WorktreeEntry>, String> {
    let roots = crate::cleanup_roots::scan_roots(&app, &extra_roots)?;
    CANCEL.store(false, Ordering::Relaxed);
    let emitter = ProgressEmitter::new(app, PROGRESS_EVENT, "scan");
    let found = tauri::async_runtime::spawn_blocking(move || {
        let step = |step| emitter.step(step);
        scan(
            &roots,
            &Progress {
                on_step: &step,
                cancel: &CANCEL,
            },
        )
    })
    .await
    .map_err(|error| format!("Worktree scan failed: {error}"))?;
    with_scanned(|known| {
        known.clear();
        for item in &found {
            known.insert(
                item.entry.path.clone(),
                Known {
                    repo: item.repo.clone(),
                    path: PathBuf::from(&item.entry.path),
                    branch: item.entry.branch.clone(),
                    base: item.entry.base.clone(),
                    missing: item.entry.missing,
                },
            );
        }
    });
    Ok(found.into_iter().map(|item| item.entry).collect())
}

/// Removes the worktrees at `paths` (from the last scan). `force` also removes uncommitted changes;
/// `delete_merged_branches` deletes each removed worktree's branch when it is merged.
#[tauri::command]
pub async fn worktree_cleanup_remove(
    paths: Vec<String>,
    force: bool,
    delete_merged_branches: bool,
) -> Result<WorktreeRemoveReport, String> {
    if paths.is_empty() || paths.len() > 1024 {
        return Err("Invalid worktree list.".to_string());
    }
    let chosen: Vec<Result<Known, String>> = with_scanned(|known| {
        paths
            .iter()
            .map(|path| known.get(path).cloned().ok_or_else(|| path.clone()))
            .collect()
    });
    let report = tauri::async_runtime::spawn_blocking(move || {
        remove_all(chosen, force, delete_merged_branches)
    })
    .await
    .map_err(|error| format!("Worktree removal failed: {error}"))?;
    with_scanned(|known| {
        for path in &report.removed {
            known.remove(path);
        }
    });
    Ok(report)
}

/// Stops the running scan at its next worktree.
#[tauri::command]
pub fn worktree_cleanup_cancel() {
    CANCEL.store(true, Ordering::Relaxed);
}

fn failure(path: &str, reason: impl Into<String>) -> RemoveFailure {
    RemoveFailure {
        path: path.to_string(),
        reason: reason.into(),
    }
}

fn remove_all(
    chosen: Vec<Result<Known, String>>,
    force: bool,
    delete_merged_branches: bool,
) -> WorktreeRemoveReport {
    let mut report = WorktreeRemoveReport::default();
    let mut to_prune: BTreeMap<PathBuf, Vec<String>> = BTreeMap::new();
    for item in chosen {
        let known = match item {
            Ok(known) => known,
            Err(path) => {
                report
                    .failed
                    .push(failure(&path, "Not found by the last scan. Scan again."));
                continue;
            }
        };
        let shown = known.path.to_string_lossy().into_owned();
        if known.missing && !known.path.exists() {
            to_prune.entry(known.repo.clone()).or_default().push(shown);
            continue;
        }
        let repo = match Repo::discover(&known.repo) {
            Ok(Some(repo)) => repo,
            _ => {
                report
                    .failed
                    .push(failure(&shown, "Its repository can no longer be opened."));
                continue;
            }
        };
        if let Err(error) = repo.remove_worktree(&known.path, force) {
            report.failed.push(failure(&shown, error.to_string()));
            continue;
        }
        report.removed.push(shown.clone());
        if delete_merged_branches {
            delete_if_merged(&repo, &known, &mut report);
        }
    }
    for (repo_root, paths) in to_prune {
        let pruned = Repo::discover(&repo_root)
            .ok()
            .flatten()
            .ok_or_else(|| "Its repository can no longer be opened.".to_string())
            .and_then(|repo| repo.prune_worktrees().map_err(|error| error.to_string()));
        match pruned {
            Ok(()) => report.removed.extend(paths),
            Err(reason) => report
                .failed
                .extend(paths.iter().map(|path| failure(path, reason.clone()))),
        }
    }
    report
}

/// Deletes the removed worktree's branch when its tip is still on the main-line branch.
fn delete_if_merged(repo: &Repo, known: &Known, report: &mut WorktreeRemoveReport) {
    let (Some(branch), Some(base)) = (&known.branch, &known.base) else {
        return;
    };
    if branch == base {
        return;
    }
    let tip = repo
        .branches()
        .ok()
        .and_then(|all| all.into_iter().find(|b| !b.remote && &b.name == branch))
        .map(|b| b.commit);
    let merged = tip
        .as_deref()
        .is_some_and(|tip| repo.merge_base(branch, base).ok().flatten().as_deref() == Some(tip));
    if !merged {
        report
            .kept_branches
            .push(failure(branch, format!("Not merged into {base}.")));
        return;
    }
    // Force, because `git branch -d` checks against the main tree's current branch, which may
    // not be the main line; the merge into the main line was checked just above.
    match repo.delete_branch(branch, true) {
        Ok(()) => report.deleted_branches.push(branch.clone()),
        Err(error) => report
            .kept_branches
            .push(failure(branch, error.to_string())),
    }
}
