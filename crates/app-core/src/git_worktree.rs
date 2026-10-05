//! Worktree discovery: listing every worktree of a repository and telling whether a checkout is
//! the main worktree or a linked one (`git worktree add`, which is how agents such as Claude Code
//! isolate their edits from the main checkout).

use crate::git::run_git_cmd;
use app_protocol::git::GitWorktreeInfo;
use std::path::{Path, PathBuf};

#[cfg(test)]
#[path = "git_worktree_tests.rs"]
mod tests;

/// Parses `git worktree list --porcelain`: one blank-line separated block per worktree, the main
/// worktree first. `is_current` is left unset; only the caller knows which checkout it is in.
pub fn parse_worktree_porcelain(text: &str) -> Vec<GitWorktreeInfo> {
    let mut worktrees = Vec::new();
    let mut entry: Option<GitWorktreeInfo> = None;
    for line in text.lines().map(str::trim_end) {
        if let Some(path) = line.strip_prefix("worktree ") {
            worktrees.extend(entry.take());
            entry = Some(GitWorktreeInfo {
                path: path.to_string(),
                is_main: worktrees.is_empty(),
                ..GitWorktreeInfo::default()
            });
            continue;
        }
        let Some(current) = entry.as_mut() else {
            continue;
        };
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));
        match key {
            "HEAD" => current.head = Some(value.to_string()),
            "branch" => {
                let name = value.strip_prefix("refs/heads/").unwrap_or(value);
                current.branch = Some(name.to_string());
            }
            "detached" => current.is_detached = true,
            "bare" => current.is_bare = true,
            "locked" => current.is_locked = true,
            "prunable" => current.is_prunable = true,
            _ => {}
        }
    }
    worktrees.extend(entry);
    worktrees
}

/// git prints forward-slashed paths on Windows; canonicalizing makes them comparable with the
/// repository roots the other services report. A pruned worktree keeps the path git printed.
fn canonical(path: &str) -> PathBuf {
    let path = PathBuf::from(path);
    dunce::canonicalize(&path).unwrap_or(path)
}

/// Every worktree of the repository containing `repo_root`, marking the one `repo_root` is in.
pub fn list_worktrees(repo_root: &Path) -> Result<Vec<GitWorktreeInfo>, String> {
    let stdout = run_git_cmd(repo_root, &["worktree", "list", "--porcelain"])?;
    let current = dunce::canonicalize(repo_root).unwrap_or_else(|_| repo_root.to_path_buf());
    let mut worktrees = parse_worktree_porcelain(&String::from_utf8_lossy(&stdout));
    for worktree in &mut worktrees {
        let path = canonical(&worktree.path);
        worktree.is_current = path == current;
        worktree.path = path.to_string_lossy().into_owned();
    }
    Ok(worktrees)
}

/// The main worktree's root when `repo_root` is a linked worktree, `None` for the main worktree
/// itself. A linked worktree has its own git dir under the shared common dir.
pub fn main_worktree_of(repo_root: &Path) -> Option<String> {
    let stdout = run_git_cmd(
        repo_root,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-dir",
            "--git-common-dir",
        ],
    )
    .ok()?;
    let text = String::from_utf8_lossy(&stdout);
    let mut lines = text.lines().map(str::trim).filter(|line| !line.is_empty());
    let (git_dir, common_dir) = (canonical(lines.next()?), canonical(lines.next()?));
    if git_dir == common_dir {
        return None;
    }
    // A non-bare main worktree keeps its common dir in `<root>/.git`; a bare one is the dir itself.
    let main = match common_dir.file_name() {
        Some(name) if name == ".git" => common_dir.parent()?.to_path_buf(),
        _ => common_dir,
    };
    Some(main.to_string_lossy().into_owned())
}
