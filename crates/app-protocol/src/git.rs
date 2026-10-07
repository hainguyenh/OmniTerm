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

/// File update detail within a specific commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitCommitFileChange {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: GitFileStatus,
    pub additions: u32,
    pub deletions: u32,
    pub is_binary: bool,
}

/// Comprehensive details of a single commit point.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitCommitDetails {
    pub commit: GitCommitSummary,
    pub full_message: String,
    pub files: Vec<GitCommitFileChange>,
    pub total_additions: u32,
    pub total_deletions: u32,
    pub total_files: usize,
}

#[cfg(test)]
#[path = "git_tests.rs"]
mod tests;
