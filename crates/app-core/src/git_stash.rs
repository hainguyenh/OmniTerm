//! Git stash and cherry-pick operations.
//!
//! Provides support for listing, saving, applying, popping, and dropping stashes,
//! as well as cherry-picking commits.

use crate::git::run_git_cmd;
use app_protocol::git::GitStashEntry;
use std::path::Path;

/// Parses a single line from `git stash list --pretty=format:%gd\x1f%cr\x1f%gs`.
pub fn parse_stash_line(line: &str) -> Option<GitStashEntry> {
    let parts: Vec<&str> = line.split('\x1f').collect();
    if parts.is_empty() {
        return None;
    }
    let name = parts[0].trim();
    if !name.starts_with("stash@{") {
        return None;
    }
    let idx_str = name.strip_prefix("stash@{")?.strip_suffix('}')?;
    let index: usize = idx_str.parse().ok()?;

    let timestamp = parts.get(1).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let message = parts.get(2).map(|s| s.trim().to_string()).unwrap_or_else(|| "WIP".into());

    Some(GitStashEntry {
        index,
        name: name.to_string(),
        message,
        timestamp,
    })
}

/// Lists all stash entries in the repository.
pub fn stash_list(repo_root: &Path) -> Result<Vec<GitStashEntry>, String> {
    let stdout = run_git_cmd(
        repo_root,
        &["stash", "list", "--pretty=format:%gd\x1f%cr\x1f%gs"],
    )?;
    let text = String::from_utf8_lossy(&stdout);
    let mut entries = Vec::new();
    for line in text.lines() {
        if let Some(entry) = parse_stash_line(line) {
            entries.push(entry);
        }
    }
    Ok(entries)
}

/// Creates a new stash with an optional message and optional `--keep-index`.
pub fn stash_save(
    repo_root: &Path,
    message: Option<&str>,
    keep_index: bool,
) -> Result<String, String> {
    let mut args = vec!["stash", "push"];
    if keep_index {
        args.push("--keep-index");
    }
    if let Some(msg) = message {
        let trimmed = msg.trim();
        if !trimmed.is_empty() {
            args.push("-m");
            args.push(trimmed);
        }
    }
    let stdout = run_git_cmd(repo_root, &args)?;
    let res = String::from_utf8_lossy(&stdout).trim().to_string();
    Ok(if res.is_empty() {
        "Saved working directory and index state".into()
    } else {
        res
    })
}

/// Applies and removes a stash entry (default: latest `stash@{0}`).
pub fn stash_pop(repo_root: &Path, index: Option<usize>) -> Result<String, String> {
    let stash_ref = match index {
        Some(idx) => format!("stash@{{{}}}", idx),
        None => "stash@{0}".to_string(),
    };
    let stdout = run_git_cmd(repo_root, &["stash", "pop", &stash_ref])?;
    Ok(String::from_utf8_lossy(&stdout).trim().to_string())
}

/// Applies a stash entry without removing it.
pub fn stash_apply(repo_root: &Path, index: Option<usize>) -> Result<String, String> {
    let stash_ref = match index {
        Some(idx) => format!("stash@{{{}}}", idx),
        None => "stash@{0}".to_string(),
    };
    let stdout = run_git_cmd(repo_root, &["stash", "apply", &stash_ref])?;
    Ok(String::from_utf8_lossy(&stdout).trim().to_string())
}

/// Drops a specific stash entry.
pub fn stash_drop(repo_root: &Path, index: usize) -> Result<String, String> {
    let stash_ref = format!("stash@{{{}}}", index);
    let stdout = run_git_cmd(repo_root, &["stash", "drop", &stash_ref])?;
    Ok(String::from_utf8_lossy(&stdout).trim().to_string())
}

/// Cherry-picks a commit onto the current HEAD.
pub fn cherry_pick(repo_root: &Path, commit_id: &str) -> Result<String, String> {
    let trimmed = commit_id.trim();
    if trimmed.is_empty() {
        return Err("Commit hash cannot be empty".into());
    }
    let stdout = run_git_cmd(repo_root, &["cherry-pick", trimmed])?;
    let res = String::from_utf8_lossy(&stdout).trim().to_string();
    Ok(if res.is_empty() {
        format!("Cherry-pick of {} succeeded", trimmed)
    } else {
        res
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_stash_line() {
        let line = "stash@{0}\x1f2 hours ago\x1fWIP on main: 1234abc feat: initial";
        let entry = parse_stash_line(line).expect("parse stash entry");
        assert_eq!(entry.index, 0);
        assert_eq!(entry.name, "stash@{0}");
        assert_eq!(entry.timestamp.as_deref(), Some("2 hours ago"));
        assert_eq!(entry.message, "WIP on main: 1234abc feat: initial");

        let invalid = "not a stash line";
        assert!(parse_stash_line(invalid).is_none());
    }
}
