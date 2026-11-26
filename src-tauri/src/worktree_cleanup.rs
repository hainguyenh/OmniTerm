//! Clean Up › Worktrees: the linked worktrees of every repository under the search roots, with
//! the facts the panel's suggestions rest on — uncommitted changes, the branch's remote state,
//! whether it is merged into the main branch, when it was last used, and its size. Git runs in
//! Restricted Mode (no hooks, filters or configured programs), as for any untrusted repository.

use app_core::rust_cleanup::{folder_size, Progress, Step};
use ide_vcs::{Branch, Repo, Worktree};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Branch names taken as the repository's main line, in order of preference.
const BASE_CANDIDATES: [&str; 4] = ["main", "master", "develop", "trunk"];

/// One linked worktree as the panel shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeEntry {
    /// The worktree folder; also its id in a removal.
    pub path: String,
    /// The main working tree of its repository.
    pub repo: String,
    pub repo_name: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub locked: bool,
    /// Git lists it but its folder is gone.
    pub missing: bool,
    /// Uncommitted changes (untracked files included); `None` when unknown or missing.
    pub changes: Option<u32>,
    /// Last commit on its branch or last index change, whichever is newer (ms since the epoch).
    pub last_active_ms: f64,
    pub upstream: Option<String>,
    /// The branch tracks a remote branch that no longer exists.
    pub upstream_gone: bool,
    pub ahead: u32,
    pub behind: u32,
    /// The main-line branch merges are checked against.
    pub base: Option<String>,
    /// Every commit of the worktree is already on `base`.
    pub merged: bool,
    pub bytes: Option<u64>,
}

/// A scanned worktree and what a removal needs to find it again.
pub(crate) struct Found {
    pub entry: WorktreeEntry,
    pub repo: PathBuf,
}

/// The main-line branch of a repository: a local `main`, `master`, `develop` or `trunk`, else the
/// branch checked out in the main working tree.
pub(crate) fn base_branch(branches: &[Branch], main_branch: Option<&str>) -> Option<String> {
    BASE_CANDIDATES
        .iter()
        .find(|name| branches.iter().any(|b| !b.remote && b.name == **name))
        .map(|name| (*name).to_string())
        .or_else(|| main_branch.map(str::to_string))
}

/// Whether `branch` tracks a remote branch that is no longer there (deleted after a merge).
pub(crate) fn upstream_gone(branch: &Branch, branches: &[Branch]) -> bool {
    branch
        .upstream
        .as_deref()
        .is_some_and(|upstream| !branches.iter().any(|b| b.remote && b.name == upstream))
}

/// When the worktree's index last changed (a checkout, an add, a commit), in ms since the epoch.
fn index_changed_ms(worktree: &Path) -> f64 {
    let Ok(text) = std::fs::read_to_string(worktree.join(".git")) else {
        return 0.0;
    };
    let Some(git_dir) = text.trim().strip_prefix("gitdir:") else {
        return 0.0;
    };
    let index = worktree.join(git_dir.trim()).join("index");
    std::fs::metadata(index)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0.0, |elapsed| elapsed.as_millis() as f64)
}

/// One repository and its linked worktrees, read before any of them is sized.
struct RepoPlan {
    root: PathBuf,
    repo: Repo,
    branches: Vec<Branch>,
    base: Option<String>,
    linked: Vec<Worktree>,
}

/// The repositories under `roots`, each once however many of its worktrees are roots.
fn plan(roots: &[PathBuf]) -> Vec<RepoPlan> {
    let mut seen = std::collections::HashSet::new();
    let mut plans = Vec::new();
    for root in roots {
        let Ok(Some(found)) = Repo::discover(root) else {
            continue;
        };
        let Ok(list) = found.worktrees() else {
            continue;
        };
        let Some(main) = list.iter().find(|worktree| worktree.main) else {
            continue;
        };
        let main_root = main.path.to_path_buf();
        let key = dunce::canonicalize(&main_root).unwrap_or_else(|_| main_root.clone());
        if !seen.insert(key) {
            continue;
        }
        let Ok(Some(repo)) = Repo::discover(&main_root) else {
            continue;
        };
        let branches = repo.branches().unwrap_or_default();
        let base = base_branch(&branches, main.branch.as_deref());
        let linked = list.into_iter().filter(|worktree| !worktree.main).collect();
        plans.push(RepoPlan {
            root: main_root,
            repo,
            branches,
            base,
            linked,
        });
    }
    plans
}

/// Every linked worktree of the repositories under `roots`.
pub(crate) fn scan(roots: &[PathBuf], progress: &Progress<'_>) -> Vec<Found> {
    let plans = plan(roots);
    let total = plans.iter().map(|p| p.linked.len() as u64).sum();
    let (mut done, mut bytes_so_far) = (0u64, 0u64);
    let mut found = Vec::new();
    for plan in &plans {
        for worktree in &plan.linked {
            if progress.cancelled() {
                return found;
            }
            let entry = describe(plan, worktree, progress);
            done += 1;
            bytes_so_far += entry.bytes.unwrap_or(0);
            (progress.on_step)(Step {
                done,
                total,
                bytes: bytes_so_far,
            });
            found.push(Found {
                entry,
                repo: plan.root.clone(),
            });
        }
    }
    found
}

fn describe(plan: &RepoPlan, worktree: &Worktree, progress: &Progress<'_>) -> WorktreeEntry {
    let path = worktree.path.to_path_buf();
    let missing = !path.is_dir();
    let branch = worktree
        .branch
        .as_deref()
        .and_then(|name| plan.branches.iter().find(|b| !b.remote && b.name == name));
    let changes = (!missing)
        .then(|| Repo::discover(&path).ok().flatten())
        .flatten()
        .and_then(|repo| repo.status().ok())
        .map(|status| u32::try_from(status.len()).unwrap_or(u32::MAX));
    let merged = match (&worktree.head, &plan.base) {
        (Some(head), Some(base)) if worktree.branch.as_deref() != Some(base.as_str()) => {
            plan.repo.merge_base(head, base).ok().flatten().as_deref() == Some(head.as_str())
        }
        _ => false,
    };
    let last_commit = branch.map_or(0.0, |b| b.last_commit_ms);
    WorktreeEntry {
        path: path.to_string_lossy().into_owned(),
        repo: plan.root.to_string_lossy().into_owned(),
        repo_name: plan
            .root
            .file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().into_owned()),
        branch: worktree.branch.clone(),
        head: worktree.head.clone(),
        locked: worktree.locked,
        missing: missing || worktree.prunable,
        changes,
        last_active_ms: last_commit.max(index_changed_ms(&path)),
        upstream: branch.and_then(|b| b.upstream.clone()),
        upstream_gone: branch.is_some_and(|b| upstream_gone(b, &plan.branches)),
        ahead: branch.map_or(0, |b| b.ahead),
        behind: branch.map_or(0, |b| b.behind),
        base: plan.base.clone(),
        merged,
        bytes: (!missing).then(|| folder_size(&path, progress).1),
    }
}
