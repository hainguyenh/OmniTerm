//! Branch maintenance that never touches the working tree: fast-forwarding a branch that is not
//! checked out, renaming, changing its upstream, and checking it out into a separate worktree.
//!
//! Branch names and paths come from the renderer and go straight into git's argv, so each one is
//! validated first — a value starting with `-` would otherwise be parsed as an option.

use crate::git::run_git_cmd;
use std::path::{Path, PathBuf};

#[cfg(test)]
#[path = "git_branch_tools_tests.rs"]
mod tests;

/// Rejects empty values and values git would read as an option.
fn checked<'a>(what: &str, value: &'a str) -> Result<&'a str, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{what} must not be empty"));
    }
    if value.starts_with('-') {
        return Err(format!("{what} must not start with '-': {value}"));
    }
    Ok(value)
}

/// A local branch name git accepts (`git check-ref-format --branch`).
fn checked_branch<'a>(repo_root: &Path, what: &str, name: &'a str) -> Result<&'a str, String> {
    let name = checked(what, name)?;
    run_git_cmd(repo_root, &["check-ref-format", "--branch", name])
        .map_err(|_| format!("'{name}' is not a valid branch name"))?;
    Ok(name)
}

fn git_text(repo_root: &Path, args: &[&str]) -> Result<String, String> {
    run_git_cmd(repo_root, args).map(|out| String::from_utf8_lossy(&out).trim().to_string())
}

fn config_value(repo_root: &Path, key: &str) -> Option<String> {
    git_text(repo_root, &["config", "--get", key])
        .ok()
        .filter(|value| !value.is_empty())
}

/// Fast-forwards `branch` to its upstream without checking it out.
///
/// Uses `git fetch <remote> <merge>:refs/heads/<branch>` with no `+`, so git itself refuses a
/// non-fast-forward update (and refuses to move a branch checked out in any worktree). A local
/// upstream (`remote = .`) works the same way.
pub fn update_branch_without_checkout(repo_root: &Path, branch: &str) -> Result<String, String> {
    let branch = checked_branch(repo_root, "Branch", branch)?;
    let current = git_text(repo_root, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();
    if current == branch {
        return Err(format!("'{branch}' is checked out; pull it instead"));
    }
    let (Some(remote), Some(merge)) = (
        config_value(repo_root, &format!("branch.{branch}.remote")),
        config_value(repo_root, &format!("branch.{branch}.merge")),
    ) else {
        return Err(format!("'{branch}' has no upstream to update from"));
    };
    let local_ref = format!("refs/heads/{branch}");
    let before = git_text(repo_root, &["rev-parse", &local_ref])?;
    let refspec = format!("{merge}:{local_ref}");
    run_git_cmd(repo_root, &["fetch", &remote, &refspec]).map_err(|err| {
        if err.contains("non-fast-forward") || err.contains("rejected") {
            format!("'{branch}' has diverged from its upstream; check it out to merge or rebase")
        } else {
            err
        }
    })?;
    let after = git_text(repo_root, &["rev-parse", &local_ref])?;
    let upstream = git_text(
        repo_root,
        &[
            "rev-parse",
            "--abbrev-ref",
            &format!("{branch}@{{upstream}}"),
        ],
    )
    .unwrap_or(merge);
    Ok(if before == after {
        format!("'{branch}' is already up to date with {upstream}")
    } else {
        format!("Fast-forwarded '{branch}' to {upstream}")
    })
}

/// Renames a local branch (`git branch -m`); git refuses when `new_name` already exists.
pub fn rename_branch(repo_root: &Path, old_name: &str, new_name: &str) -> Result<String, String> {
    let old_name = checked_branch(repo_root, "Branch", old_name)?;
    let new_name = checked_branch(repo_root, "New branch name", new_name)?;
    run_git_cmd(repo_root, &["branch", "-m", old_name, new_name])?;
    Ok(format!("Renamed '{old_name}' to '{new_name}'"))
}

/// Points `branch` at `upstream` (e.g. `origin/main`), or removes its upstream when `None`.
pub fn set_branch_upstream(
    repo_root: &Path,
    branch: &str,
    upstream: Option<&str>,
) -> Result<String, String> {
    let branch = checked_branch(repo_root, "Branch", branch)?;
    match upstream.map(str::trim).filter(|value| !value.is_empty()) {
        Some(upstream) => {
            let upstream = checked("Upstream", upstream)?;
            let flag = format!("--set-upstream-to={upstream}");
            run_git_cmd(repo_root, &["branch", &flag, branch])?;
            Ok(format!("'{branch}' now tracks {upstream}"))
        }
        None => {
            run_git_cmd(repo_root, &["branch", "--unset-upstream", branch])?;
            Ok(format!("'{branch}' no longer tracks an upstream"))
        }
    }
}

/// Where a branch's worktree goes by default: `<repo>.worktrees/<branch>` next to the repository,
/// with `/` in the branch name flattened so `feature/x` stays one directory.
pub fn default_worktree_path(repo_root: &Path, branch: &str) -> PathBuf {
    let repo_name = repo_root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "repo".to_string());
    let parent = repo_root.parent().unwrap_or(repo_root);
    parent
        .join(format!("{repo_name}.worktrees"))
        .join(branch.replace(['/', '\\'], "-"))
}

/// Checks `branch` out into a new worktree and returns the worktree's path. A remote branch
/// (`origin/x`) gets a local tracking branch named after it, the way checkout does.
pub fn add_worktree(repo_root: &Path, branch: &str, path: Option<&str>) -> Result<String, String> {
    let branch = checked("Branch", branch)?;
    let is_local = run_git_cmd(
        repo_root,
        &[
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
    )
    .is_ok();
    let local_name = if is_local {
        branch.to_string()
    } else {
        let remote_ref = format!("refs/remotes/{branch}");
        run_git_cmd(repo_root, &["show-ref", "--verify", "--quiet", &remote_ref])
            .map_err(|_| format!("Unknown branch '{branch}'"))?;
        let name = branch.split_once('/').map_or(branch, |(_, name)| name);
        checked_branch(repo_root, "Branch", name)?.to_string()
    };
    let target = match path.map(str::trim).filter(|value| !value.is_empty()) {
        Some(path) => PathBuf::from(checked("Worktree path", path)?),
        None => default_worktree_path(repo_root, &local_name),
    };
    if target.exists() {
        return Err(format!("{} already exists", target.display()));
    }
    let target_text = target.to_string_lossy().into_owned();
    if is_local {
        run_git_cmd(repo_root, &["worktree", "add", &target_text, branch])?;
    } else {
        run_git_cmd(
            repo_root,
            &[
                "worktree",
                "add",
                "--track",
                "-b",
                &local_name,
                &target_text,
                branch,
            ],
        )?;
    }
    Ok(target_text)
}
