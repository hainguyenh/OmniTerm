//! Git branch and remote synchronization operations.
//!
//! Provides high-performance branch listing, checkout, branch creation,
//! remote fetching, pull (smart merge/rebase), push, and repository initialization.

use crate::git::run_git_cmd;
pub use crate::git_branch_compare::compare_branches;
pub use crate::git_branch_delete::delete_branches;
use app_protocol::git::GitBranchInfo;
use std::collections::HashSet;
use std::path::Path;

/// Parses a branch track string such as `"[ahead 1, behind 2]"` or `"[gone]"`.
fn parse_track(track: &str) -> (u32, u32, bool) {
    let mut ahead = 0;
    let mut behind = 0;
    let is_gone = track.contains("[gone]");

    let trimmed = track.trim_matches(|c| c == '[' || c == ']');
    for part in trimmed.split(',') {
        let p = part.trim();
        if let Some(rest) = p.strip_prefix("ahead ") {
            ahead = rest.parse().unwrap_or(0);
        } else if let Some(rest) = p.strip_prefix("behind ") {
            behind = rest.parse().unwrap_or(0);
        }
    }

    (ahead, behind, is_gone)
}

/// Parses a single line from `git branch -a --format=...`, whose first field is the full refname:
/// `refs/remotes/` marks a remote branch whatever the remote is called.
pub fn parse_branch_line(line: &str) -> Option<GitBranchInfo> {
    let parts: Vec<&str> = line.split('\t').collect();
    let refname = parts.first()?.trim();
    let (name, is_remote) = match refname.strip_prefix("refs/remotes/") {
        Some(name) => (name, true),
        None => (
            refname.strip_prefix("refs/heads/").unwrap_or(refname),
            false,
        ),
    };
    if name.is_empty() || name == "HEAD" || name.ends_with("/HEAD") {
        return None;
    }

    let is_current = parts.get(1).map(|s| s.trim() == "*").unwrap_or(false);
    let upstream_raw = parts.get(2).map(|s| s.trim()).unwrap_or("");
    let upstream = if upstream_raw.is_empty() {
        None
    } else {
        Some(upstream_raw.to_string())
    };

    let track_raw = parts.get(3).map(|s| s.trim()).unwrap_or("");
    let (ahead, behind, is_gone) = parse_track(track_raw);

    let last_commit_timestamp = parts.get(4).and_then(|s| s.trim().parse::<i64>().ok());
    let last_commit_message = parts
        .get(5)
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let last_commit_author = parts
        .get(6)
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    Some(GitBranchInfo {
        name: name.to_string(),
        is_current,
        is_remote,
        upstream,
        ahead,
        behind,
        is_gone,
        last_commit_timestamp,
        last_commit_message,
        last_commit_author,
        is_merged: false,
    })
}

fn get_merged_branches(repo_root: &Path) -> HashSet<String> {
    let mut set = HashSet::new();
    if let Ok(stdout) = run_git_cmd(repo_root, &["branch", "--merged"]) {
        for line in String::from_utf8_lossy(&stdout).lines() {
            // `*` marks this checkout's branch and `+` one checked out in another worktree.
            let name = line.trim().trim_start_matches(['*', '+']).trim();
            if !name.is_empty() {
                set.insert(name.to_string());
            }
        }
    }
    set
}

/// Lists all local and remote branches in the repository.
pub fn get_branches(repo_root: &Path) -> Result<Vec<GitBranchInfo>, String> {
    // The full refname, not `short`: `short` turns `refs/remotes/origin/HEAD` into a bare `origin`,
    // which then slipped past the `/HEAD` filter and was listed as a local branch named `origin`.
    let stdout = run_git_cmd(
        repo_root,
        &[
            "branch",
            "-a",
            "--format=%(refname)\t%(HEAD)\t%(upstream:short)\t%(upstream:track)\t%(committerdate:unix)\t%(subject)\t%(authorname)",
        ],
    )?;
    let text = String::from_utf8_lossy(&stdout);

    let merged_set = get_merged_branches(repo_root);
    let mut branches = Vec::new();
    for line in text.lines() {
        if let Some(mut info) = parse_branch_line(line) {
            if merged_set.contains(&info.name) {
                info.is_merged = true;
            }
            branches.push(info);
        }
    }

    Ok(branches)
}

fn ref_exists(repo_root: &Path, refname: &str) -> bool {
    run_git_cmd(repo_root, &["show-ref", "--verify", "--quiet", refname]).is_ok()
}

/// The local branch a remote branch checks out as: `origin/feature/x` becomes `feature/x`. The
/// longest matching remote wins, so a remote whose name contains `/` is stripped whole.
fn local_name_of<'a>(repo_root: &Path, remote_branch: &'a str) -> &'a str {
    let remotes = run_git_cmd(repo_root, &["remote"])
        .map(|out| String::from_utf8_lossy(&out).into_owned())
        .unwrap_or_default();
    remotes
        .lines()
        .map(str::trim)
        .filter_map(|remote| remote_branch.strip_prefix(remote)?.strip_prefix('/'))
        .min_by_key(|name| name.len())
        .or_else(|| remote_branch.split_once('/').map(|(_, name)| name))
        .unwrap_or(remote_branch)
}

/// Switches to the specified branch or checkout target. A remote branch is checked out as its
/// local tracking branch (created when missing) rather than as a detached `HEAD`.
pub fn checkout_branch(repo_root: &Path, branch_name: &str) -> Result<String, String> {
    let name = branch_name.trim();
    if name.starts_with('-') {
        return Err(format!("Branch must not start with '-': {name}"));
    }
    let is_remote_only = !ref_exists(repo_root, &format!("refs/heads/{name}"))
        && ref_exists(repo_root, &format!("refs/remotes/{name}"));
    let stdout = if !is_remote_only {
        run_git_cmd(repo_root, &["checkout", name])?
    } else {
        let local = local_name_of(repo_root, name);
        if ref_exists(repo_root, &format!("refs/heads/{local}")) {
            run_git_cmd(repo_root, &["checkout", local])?
        } else {
            run_git_cmd(repo_root, &["checkout", "-b", local, "--track", name])?
        }
    };
    Ok(String::from_utf8_lossy(&stdout).trim().to_string())
}

/// Creates a new branch, optionally checking it out immediately.
pub fn create_branch(
    repo_root: &Path,
    name: &str,
    start_point: Option<&str>,
    checkout: bool,
) -> Result<String, String> {
    let mut args = Vec::new();
    if checkout {
        args.push("checkout");
        args.push("-b");
        args.push(name);
    } else {
        args.push("branch");
        args.push(name);
    }
    if let Some(sp) = start_point {
        if !sp.trim().is_empty() {
            args.push(sp);
        }
    }

    let stdout = run_git_cmd(repo_root, &args)?;
    Ok(String::from_utf8_lossy(&stdout).trim().to_string())
}

/// Fetches from remotes, optionally pruning deleted remote references.
pub fn fetch_repo(repo_root: &Path, prune: bool) -> Result<String, String> {
    let mut args = vec!["fetch"];
    if prune {
        args.push("--prune");
    }
    let stdout = run_git_cmd(repo_root, &args)?;
    let res = String::from_utf8_lossy(&stdout).trim().to_string();
    Ok(if res.is_empty() {
        "Fetch completed successfully".into()
    } else {
        res
    })
}

/// Pulls from upstream with optional rebase (Smart Update).
pub fn pull_repo(repo_root: &Path, rebase: bool) -> Result<String, String> {
    let mut args = vec!["pull"];
    if rebase {
        args.push("--rebase");
    }
    let stdout = run_git_cmd(repo_root, &args)?;
    let res = String::from_utf8_lossy(&stdout).trim().to_string();
    Ok(if res.is_empty() {
        "Already up to date".into()
    } else {
        res
    })
}

/// Pushes current branch commits to remote.
pub fn push_repo(repo_root: &Path, set_upstream: bool) -> Result<String, String> {
    let mut args = vec!["push"];
    if set_upstream {
        args.push("-u");
        args.push("origin");
        args.push("HEAD");
    }
    let stdout = run_git_cmd(repo_root, &args)?;
    let res = String::from_utf8_lossy(&stdout).trim().to_string();
    Ok(if res.is_empty() {
        "Push completed successfully".into()
    } else {
        res
    })
}

/// Merges the specified branch into the current working branch.
pub fn merge_branch(repo_root: &Path, branch_name: &str) -> Result<String, String> {
    let stdout = run_git_cmd(repo_root, &["merge", branch_name])?;
    let res = String::from_utf8_lossy(&stdout).trim().to_string();
    Ok(if res.is_empty() {
        "Merge completed successfully".into()
    } else {
        res
    })
}

/// Rebases current branch onto the specified branch.
pub fn rebase_branch(repo_root: &Path, branch_name: &str) -> Result<String, String> {
    let stdout = run_git_cmd(repo_root, &["rebase", branch_name])?;
    let res = String::from_utf8_lossy(&stdout).trim().to_string();
    Ok(if res.is_empty() {
        "Rebase completed successfully".into()
    } else {
        res
    })
}

/// Initializes a new git repository in the directory.
pub fn init_repo(path: &Path) -> Result<String, String> {
    let stdout = run_git_cmd(path, &["init"])?;
    Ok(String::from_utf8_lossy(&stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_branch_line() {
        let line = "refs/heads/master\t*\torigin/master\t[ahead 1, behind 2]\t1786000000\tfeat: initial\tDev User";
        let info = parse_branch_line(line).expect("parses successfully");
        assert_eq!(info.name, "master");
        assert!(info.is_current);
        assert!(!info.is_remote);
        assert_eq!(info.upstream.as_deref(), Some("origin/master"));
        assert_eq!(info.ahead, 1);
        assert_eq!(info.behind, 2);
        assert!(!info.is_gone);
        assert_eq!(info.last_commit_timestamp, Some(1786000000));
        assert_eq!(info.last_commit_message.as_deref(), Some("feat: initial"));
        assert_eq!(info.last_commit_author.as_deref(), Some("Dev User"));

        let remote_line = "refs/remotes/origin/main\t \t\t\t\t\t";
        let remote_info = parse_branch_line(remote_line).expect("parses remote branch");
        assert_eq!(remote_info.name, "origin/main");
        assert!(!remote_info.is_current);
        assert!(remote_info.is_remote);
        assert_eq!(remote_info.upstream, None);
        assert_eq!(remote_info.last_commit_timestamp, None);
    }

    #[test]
    fn test_parse_track_gone() {
        let (ahead, behind, is_gone) = parse_track("[gone]");
        assert_eq!(ahead, 0);
        assert_eq!(behind, 0);
        assert!(is_gone);
    }
}
