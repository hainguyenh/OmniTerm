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
    assert_eq!(entry.clone(), parsed);
    assert!(!format!("{:?}", entry).is_empty());

    let context = GitFileContext {
        repo_root: "D:/repo".into(),
        relative_path: "src/app.ts".into(),
        branch: None,
    };
    let json = serde_json::to_string(&context).expect("serialization succeeds");
    assert!(!json.contains("branch"), "absent branch is omitted: {json}");
    let parsed: GitFileContext = serde_json::from_str(&json).expect("deserialization succeeds");
    assert_eq!(context, parsed);
    assert_eq!(context.clone(), parsed);
    assert!(!format!("{:?}", context).is_empty());
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
    assert_eq!(branch.clone(), parsed);
    assert!(!format!("{:?}", branch).is_empty());
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
    assert_eq!(result.clone(), parsed);
    assert!(!format!("{:?}", result).is_empty());
    assert_eq!(GitDeleteBranchesResult::default(), GitDeleteBranchesResult::default());
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
    let parsed: GitWorktreeInfo = serde_json::from_str(&json).expect("deserialization succeeds");
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

#[test]
fn test_git_commit_details_serde_roundtrip() {
    let details = GitCommitDetails {
        commit: GitCommitSummary {
            id: "1".repeat(40),
            short_id: "1111111".into(),
            summary: "feat: detailed commit".into(),
            author_name: "Author".into(),
            author_email: "author@example.com".into(),
            timestamp: 1_700_000_000,
            parents: vec!["2".repeat(40)],
        },
        full_message: "feat: detailed commit\n\nLong description here.".into(),
        files: vec![
            GitCommitFileChange {
                path: "src/main.rs".into(),
                old_path: None,
                status: GitFileStatus::Modified,
                additions: 10,
                deletions: 2,
                is_binary: false,
            },
            GitCommitFileChange {
                path: "src/new_name.rs".into(),
                old_path: Some("src/old_name.rs".into()),
                status: GitFileStatus::Renamed,
                additions: 0,
                deletions: 0,
                is_binary: false,
            },
        ],
        total_additions: 10,
        total_deletions: 2,
        total_files: 2,
    };
    let json = serde_json::to_string(&details).expect("serialization succeeds");
    let parsed: GitCommitDetails = serde_json::from_str(&json).expect("deserialization succeeds");
    assert_eq!(details, parsed);
    assert_eq!(details.clone(), parsed);
    assert!(!format!("{:?}", details).is_empty());
    assert!(!format!("{:?}", details.files[0]).is_empty());
    assert_eq!(details.files[0].clone(), details.files[0]);
}

#[test]
fn test_git_blame_line_serde_and_traits() {
    let line = GitBlameLine {
        commit: "abcdef1234567890".into(),
        author: "Dev User".into(),
        date: "2026-10-07".into(),
        line_no: 42,
        content: "let x = 1;".into(),
    };
    let json = serde_json::to_string(&line).expect("serialization succeeds");
    let parsed: GitBlameLine = serde_json::from_str(&json).expect("deserialization succeeds");
    assert_eq!(line, parsed);
    assert_eq!(line.clone(), parsed);
    assert!(!format!("{:?}", line).is_empty());
}

#[test]
fn test_git_file_status_variants_and_traits() {
    let variants = [
        GitFileStatus::Unmodified,
        GitFileStatus::Modified,
        GitFileStatus::Added,
        GitFileStatus::Deleted,
        GitFileStatus::Renamed,
        GitFileStatus::Copied,
        GitFileStatus::Untracked,
        GitFileStatus::Ignored,
        GitFileStatus::Conflicted,
        GitFileStatus::TypeChanged,
    ];
    for v in variants {
        assert_eq!(v.clone(), v);
        assert!(!format!("{:?}", v).is_empty());
    }
    assert_eq!(GitFileStatus::default(), GitFileStatus::Unmodified);
}

#[test]
fn test_git_diff_types_and_failures() {
    let types = [
        GitDiffLineType::Context,
        GitDiffLineType::Addition,
        GitDiffLineType::Deletion,
    ];
    for t in types {
        assert_eq!(t.clone(), t);
        assert!(!format!("{:?}", t).is_empty());
    }
    let failure = GitBranchDeleteFailure {
        branch: "test".into(),
        reason: "failed".into(),
    };
    assert_eq!(failure.clone(), failure);
    assert!(!format!("{:?}", failure).is_empty());
}
