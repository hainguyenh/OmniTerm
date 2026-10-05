//! Deleting local branches, including ones checked out in a linked worktree. Agents such as
//! Claude Code isolate their edits in worktrees under `.claude/worktrees/`, and git refuses to
//! delete a branch any worktree has checked out — so such a worktree has to be removed first.

use crate::git::run_git_cmd;
use crate::git_worktree::list_worktrees;
use app_protocol::git::{GitBranchDeleteFailure, GitDeleteBranchesResult, GitWorktreeInfo};
use std::path::Path;

#[cfg(test)]
#[path = "git_branch_delete_tests.rs"]
mod tests;

/// The worktrees of the repository, after dropping entries whose directory is already gone: a
/// stale entry still pins its branch, and pruning it loses nothing.
fn live_worktrees(repo_root: &Path) -> Vec<GitWorktreeInfo> {
    let worktrees = list_worktrees(repo_root).unwrap_or_default();
    if !worktrees.iter().any(|worktree| worktree.is_prunable) {
        return worktrees;
    }
    if run_git_cmd(repo_root, &["worktree", "prune"]).is_err() {
        return worktrees;
    }
    list_worktrees(repo_root).unwrap_or(worktrees)
}

/// Mirrors the check `git branch -d` makes: merged into the branch's upstream when it has one,
/// otherwise into `HEAD`. Run before a worktree is removed, so a branch git would then refuse to
/// delete does not lose its worktree first.
fn is_fully_merged(repo_root: &Path, branch: &str) -> bool {
    let local_ref = format!("refs/heads/{branch}");
    let upstream = format!("{local_ref}@{{upstream}}");
    let target = if run_git_cmd(repo_root, &["rev-parse", "--verify", "--quiet", &upstream]).is_ok()
    {
        upstream.as_str()
    } else {
        "HEAD"
    };
    run_git_cmd(
        repo_root,
        &["merge-base", "--is-ancestor", &local_ref, target],
    )
    .is_ok()
}

/// Removes the linked worktree at `path`. Without `force` git refuses a worktree with modified or
/// untracked files, or a locked one; forcing a locked worktree takes the flag twice.
fn remove_worktree(
    repo_root: &Path,
    worktree: &GitWorktreeInfo,
    force: bool,
) -> Result<(), String> {
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
        if worktree.is_locked {
            args.push("--force");
        }
    }
    args.push(&worktree.path);
    run_git_cmd(repo_root, &args).map(|_| ())
}

/// Frees `branch` from the worktree holding it, or explains why it cannot be freed.
fn release_branch(
    repo_root: &Path,
    branch: &str,
    holder: &GitWorktreeInfo,
    force: bool,
    remove_worktrees: bool,
) -> Result<(), String> {
    if holder.is_current {
        return Err("Cannot delete the currently checked out branch".into());
    }
    if holder.is_main {
        return Err(format!(
            "'{branch}' is checked out in the main checkout at {}",
            holder.path
        ));
    }
    if !remove_worktrees {
        return Err(format!(
            "'{branch}' is checked out in the worktree at {}; remove the worktree to delete it",
            holder.path
        ));
    }
    if !force && !is_fully_merged(repo_root, branch) {
        return Err(format!("The branch '{branch}' is not fully merged"));
    }
    remove_worktree(repo_root, holder, force)
}

/// Deletes one or more local branches, optionally forcing deletion of unmerged ones. With
/// `remove_worktrees`, a branch checked out in a linked worktree takes that worktree with it.
pub fn delete_branches(
    repo_root: &Path,
    branches: &[String],
    force: bool,
    remove_worktrees: bool,
) -> Result<GitDeleteBranchesResult, String> {
    let current_branch = run_git_cmd(repo_root, &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|out| String::from_utf8_lossy(&out).trim().to_string())
        .unwrap_or_default();
    let worktrees = live_worktrees(repo_root);

    let mut result = GitDeleteBranchesResult::default();
    let flag = if force { "-D" } else { "-d" };
    let mut fail = |branch: &str, reason: String| {
        result.failed.push(GitBranchDeleteFailure {
            branch: branch.to_string(),
            reason,
        });
    };

    for branch in branches {
        let b = branch.trim();
        if b.is_empty() {
            continue;
        }
        if b.starts_with('-') {
            fail(b, format!("Branch must not start with '-': {b}"));
            continue;
        }
        if b == current_branch {
            fail(b, "Cannot delete the currently checked out branch".into());
            continue;
        }
        let holder = worktrees
            .iter()
            .find(|worktree| worktree.branch.as_deref() == Some(b));
        if let Some(holder) = holder {
            if let Err(reason) = release_branch(repo_root, b, holder, force, remove_worktrees) {
                fail(b, reason);
                continue;
            }
            result.removed_worktrees.push(holder.path.clone());
        }

        match run_git_cmd(repo_root, &["branch", flag, b]) {
            Ok(_) => result.deleted.push(b.to_string()),
            Err(reason) => fail(b, reason),
        }
    }

    Ok(result)
}
