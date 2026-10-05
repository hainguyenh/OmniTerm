//! Branch comparison operations for Git.
//!
//! Provides commit ahead/behind discovery and diff summarization between branches.

use crate::git::run_git_cmd;
use app_protocol::git::{
    GitBranchComparison, GitCommitSummary, GitFileChange, GitFileStatus,
};
use std::path::Path;

fn parse_commits_from_log(text: &str) -> Vec<GitCommitSummary> {
    let mut list = Vec::new();
    for record in text.split('\x1e') {
        let trimmed = record.trim();
        if trimmed.is_empty() {
            continue;
        }
        let fields: Vec<&str> = trimmed.split('\x1f').collect();
        if fields.len() >= 7 {
            let parents: Vec<String> = fields[6]
                .split_whitespace()
                .map(|p| p.to_string())
                .collect();
            list.push(GitCommitSummary {
                id: fields[0].to_string(),
                short_id: fields[1].to_string(),
                summary: fields[2].to_string(),
                author_name: fields[3].to_string(),
                author_email: fields[4].to_string(),
                timestamp: fields[5].parse().unwrap_or(0),
                parents,
            });
        }
    }
    list
}

/// Compares two branches, returning commits ahead/behind and changed files.
pub fn compare_branches(
    repo_root: &Path,
    base_branch: &str,
    target_branch: &str,
) -> Result<GitBranchComparison, String> {
    let format_arg = "--format=%H\x1f%h\x1f%s\x1f%an\x1f%ae\x1f%at\x1f%P\x1e";
    let ahead_range = format!("{}..{}", base_branch, target_branch);
    let behind_range = format!("{}..{}", target_branch, base_branch);

    let commits_ahead = run_git_cmd(repo_root, &["log", "-n", "100", format_arg, &ahead_range])
        .map(|out| parse_commits_from_log(&String::from_utf8_lossy(&out)))
        .unwrap_or_default();

    let commits_behind = run_git_cmd(repo_root, &["log", "-n", "100", format_arg, &behind_range])
        .map(|out| parse_commits_from_log(&String::from_utf8_lossy(&out)))
        .unwrap_or_default();

    let diff_range = format!("{}...{}", base_branch, target_branch);
    let diff_out = run_git_cmd(repo_root, &["diff", "--name-status", &diff_range])?;
    let diff_text = String::from_utf8_lossy(&diff_out);

    let mut files = Vec::new();
    for line in diff_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split('\t').collect();
        let status_code = parts.first().copied().unwrap_or("");
        let (staged_status, orig_path, path) = if status_code.starts_with('R') && parts.len() >= 3 {
            (
                GitFileStatus::Renamed,
                Some(parts[1].to_string()),
                parts[2].to_string(),
            )
        } else if parts.len() >= 2 {
            let st = match status_code.chars().next() {
                Some('A') => GitFileStatus::Added,
                Some('D') => GitFileStatus::Deleted,
                Some('M') => GitFileStatus::Modified,
                Some('C') => GitFileStatus::Copied,
                _ => GitFileStatus::Modified,
            };
            (st, None, parts[1].to_string())
        } else {
            continue;
        };

        files.push(GitFileChange {
            path,
            orig_path,
            staged: staged_status,
            unstaged: GitFileStatus::Unmodified,
            is_conflicted: false,
        });
    }

    Ok(GitBranchComparison {
        base_branch: base_branch.to_string(),
        target_branch: target_branch.to_string(),
        commits_ahead,
        commits_behind,
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_commits_from_log() {
        let sample = "c0ffee\x1fc0f\x1ffeat: test\x1fAlice\x1falice@example.com\x1f1700000000\x1fparent1\x1e";
        let commits = parse_commits_from_log(sample);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].id, "c0ffee");
        assert_eq!(commits[0].short_id, "c0f");
        assert_eq!(commits[0].summary, "feat: test");
        assert_eq!(commits[0].author_name, "Alice");
        assert_eq!(commits[0].author_email, "alice@example.com");
        assert_eq!(commits[0].timestamp, 1700000000);
        assert_eq!(commits[0].parents, vec!["parent1"]);
    }
}
