//! Git protocol DTOs for OmniTerm.
//!
//! Strongly-typed Ser/De data models representing Git repository status,
//! file changes, diffs, and commit history.

use serde::{Deserialize, Serialize};

/// High-level file status in Git working tree or index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitFileStatus {
    #[default]
    Unmodified,
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Ignored,
    Conflicted,
    TypeChanged,
}

/// A changed file in the repository index or working tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitFileChange {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orig_path: Option<String>,
    pub staged: GitFileStatus,
    pub unstaged: GitFileStatus,
    pub is_conflicted: bool,
}

/// Overall repository status snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitRepoStatus {
    pub repo_root: String,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub is_detached: bool,
    pub files: Vec<GitFileChange>,
    pub conflict_count: usize,
    /// Set only when `repo_root` is a linked worktree: the root of the main worktree it belongs to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_worktree: Option<String>,
}

/// Type of line in a unified diff chunk.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitDiffLineType {
    Context,
    Addition,
    Deletion,
}

/// A single line inside a diff hunk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitDiffLine {
    pub line_type: GitDiffLineType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_lineno: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_lineno: Option<u32>,
    pub content: String,
}

/// A unified diff hunk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitDiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub header: String,
    pub lines: Vec<GitDiffLine>,
}

/// Structured diff output for a single file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitFileDiff {
    pub path: String,
    pub is_binary: bool,
    pub hunks: Vec<GitDiffHunk>,
}

/// Compact commit descriptor for Git Log & Graph visualization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitCommitSummary {
    pub id: String,
    pub short_id: String,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub parents: Vec<String>,
}

/// Detailed descriptor for a local or remote Git branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitBranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub is_gone: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_commit_timestamp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_commit_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_commit_author: Option<String>,
    #[serde(default)]
    pub is_merged: bool,
}

/// Details of a branch deletion failure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitBranchDeleteFailure {
    pub branch: String,
    pub reason: String,
}

/// Result of deleting one or more Git branches.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct GitDeleteBranchesResult {
    pub deleted: Vec<String>,
    pub failed: Vec<GitBranchDeleteFailure>,
    /// Linked worktrees removed because they had a deleted branch checked out.
    #[serde(default)]
    pub removed_worktrees: Vec<String>,
}

/// A single line in git blame output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitBlameLine {
    pub commit: String,
    pub author: String,
    pub date: String,
    pub line_no: u32,
    pub content: String,
}

/// A stash entry from git stash list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitStashEntry {
    pub index: usize,
    pub name: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

/// Structured comparison between two branches.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitBranchComparison {
    pub base_branch: String,
    pub target_branch: String,
    pub commits_ahead: Vec<GitCommitSummary>,
    pub commits_behind: Vec<GitCommitSummary>,
    pub files: Vec<GitFileChange>,
}

/// Where a workspace file sits in its repository, so the editor can address it in git commands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitFileContext {
    pub repo_root: String,
    /// Forward-slashed path from the repository root, as git itself names the file.
    pub relative_path: String,
    /// The checked-out branch; `None` when detached or before the first commit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
}

/// One entry of `git worktree list`: the main worktree comes first, linked worktrees follow.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct GitWorktreeInfo {
    pub path: String,
    /// Short branch name; `None` when the worktree is detached or bare.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    pub is_main: bool,
    /// The worktree the listing was requested from.
    pub is_current: bool,
    pub is_detached: bool,
    pub is_bare: bool,
    pub is_locked: bool,
    /// Its directory is gone; `git worktree prune` would remove the entry.
    pub is_prunable: bool,
}

/// One commit that touched a file (or a line range of it), with the file's path at that commit —
/// which differs from today's path for commits made before a rename.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitFileHistoryEntry {
    pub commit: GitCommitSummary,
    pub path: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_git_file_history_entry_serde_roundtrip() {
        let entry = GitFileHistoryEntry {
            commit: GitCommitSummary {
                id: "a".repeat(40),
                short_id: "aaaaaaa".into(),
                summary: "feat: rename".into(),
                author_name: "Dev".into(),
                author_email: "dev@example.test".into(),
                timestamp: 1_786_026_782,
                parents: vec!["b".repeat(40)],
            },
            path: "src/old_name.rs".into(),
        };
        let json = serde_json::to_string(&entry).expect("serialization succeeds");
        let parsed: GitFileHistoryEntry =
            serde_json::from_str(&json).expect("deserialization succeeds");
        assert_eq!(entry, parsed);

        let context = GitFileContext {
            repo_root: "D:/repo".into(),
            relative_path: "src/app.ts".into(),
            branch: None,
        };
        let json = serde_json::to_string(&context).expect("serialization succeeds");
        assert!(!json.contains("branch"), "absent branch is omitted: {json}");
        let parsed: GitFileContext = serde_json::from_str(&json).expect("deserialization succeeds");
        assert_eq!(context, parsed);
    }

    #[test]
    fn test_git_branch_info_serde_roundtrip() {
        let branch = GitBranchInfo {
            name: "features/test-branch".into(),
            is_current: true,
            is_remote: false,
            upstream: Some("origin/features/test-branch".into()),
            ahead: 1,
            behind: 2,
            is_gone: false,
            last_commit_timestamp: Some(1786026782),
            last_commit_message: Some("feat: add something".into()),
            last_commit_author: Some("Dev User".into()),
            is_merged: true,
        };
        let json = serde_json::to_string(&branch).expect("serialization succeeds");
        let parsed: GitBranchInfo = serde_json::from_str(&json).expect("deserialization succeeds");
        assert_eq!(branch, parsed);
    }

    #[test]
    fn test_git_delete_branches_result_serde_roundtrip() {
        let result = GitDeleteBranchesResult {
            deleted: vec!["feat/old-branch".into()],
            failed: vec![GitBranchDeleteFailure {
                branch: "feat/active".into(),
                reason: "branch is not fully merged".into(),
            }],
            removed_worktrees: vec!["/repo/.claude/worktrees/old".into()],
        };
        let json = serde_json::to_string(&result).expect("serialization succeeds");
        let parsed: GitDeleteBranchesResult =
            serde_json::from_str(&json).expect("deserialization succeeds");
        assert_eq!(result, parsed);
    }

    #[test]
    fn test_git_repo_status_serde_roundtrip() {
        let status = GitRepoStatus {
            repo_root: "/path/to/repo".into(),
            branch: Some("main".into()),
            upstream: Some("origin/main".into()),
            ahead: 1,
            behind: 2,
            is_detached: false,
            files: vec![GitFileChange {
                path: "src/main.rs".into(),
                orig_path: None,
                staged: GitFileStatus::Modified,
                unstaged: GitFileStatus::Unmodified,
                is_conflicted: false,
            }],
            conflict_count: 0,
            main_worktree: None,
        };

        let json = serde_json::to_string(&status).expect("serialization succeeds");
        assert!(
            !json.contains("main_worktree"),
            "absent main worktree is omitted: {json}"
        );
        let parsed: GitRepoStatus = serde_json::from_str(&json).expect("deserialization succeeds");
        assert_eq!(status, parsed);

        let linked = GitRepoStatus {
            main_worktree: Some("/path/to/main".into()),
            ..status
        };
        let json = serde_json::to_string(&linked).expect("serialization succeeds");
        let parsed: GitRepoStatus = serde_json::from_str(&json).expect("deserialization succeeds");
        assert_eq!(linked, parsed);
    }

    #[test]
    fn test_git_worktree_info_serde_roundtrip() {
        let worktree = GitWorktreeInfo {
            path: "/repo/.claude/worktrees/topic".into(),
            branch: Some("topic".into()),
            head: Some("a".repeat(40)),
            is_current: true,
            ..GitWorktreeInfo::default()
        };
        let json = serde_json::to_string(&worktree).expect("serialization succeeds");
        let parsed: GitWorktreeInfo =
            serde_json::from_str(&json).expect("deserialization succeeds");
        assert_eq!(worktree, parsed);
    }

    #[test]
    fn test_git_file_diff_serde_roundtrip() {
        let diff = GitFileDiff {
            path: "README.md".into(),
            is_binary: false,
            hunks: vec![GitDiffHunk {
                old_start: 1,
                old_lines: 1,
                new_start: 1,
                new_lines: 2,
                header: "@@ -1,1 +1,2 @@".into(),
                lines: vec![
                    GitDiffLine {
                        line_type: GitDiffLineType::Deletion,
                        old_lineno: Some(1),
                        new_lineno: None,
                        content: "old".into(),
                    },
                    GitDiffLine {
                        line_type: GitDiffLineType::Addition,
                        old_lineno: None,
                        new_lineno: Some(1),
                        content: "new".into(),
                    },
                ],
            }],
        };

        let json = serde_json::to_string(&diff).expect("serialization succeeds");
        let parsed: GitFileDiff = serde_json::from_str(&json).expect("deserialization succeeds");
        assert_eq!(diff, parsed);
    }

    #[test]
    fn test_git_stash_entry_serde_roundtrip() {
        let entry = GitStashEntry {
            index: 0,
            name: "stash@{0}".into(),
            message: "WIP on main".into(),
            timestamp: Some("2 hours ago".into()),
        };
        let json = serde_json::to_string(&entry).expect("serialization succeeds");
        let parsed: GitStashEntry = serde_json::from_str(&json).expect("deserialization succeeds");
        assert_eq!(entry, parsed);
    }

    #[test]
    fn test_git_branch_comparison_serde_roundtrip() {
        let comp = GitBranchComparison {
            base_branch: "main".into(),
            target_branch: "feature".into(),
            commits_ahead: vec![],
            commits_behind: vec![],
            files: vec![],
        };
        let json = serde_json::to_string(&comp).expect("serialization succeeds");
        let parsed: GitBranchComparison =
            serde_json::from_str(&json).expect("deserialization succeeds");
        assert_eq!(comp, parsed);
    }
}
