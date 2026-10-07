//! The Git command endpoints driven directly against disposable repositories: working-tree edits,
//! commits, file reads and writes, blame, history and branch workflows.

use crate::git_commands::*;
use crate::git_commands_tests::repo::{
    commit_file, cwd, git, head, read, repo_with_commit, write, ScrubbedGitEnv,
};
use crate::test_support;
use app_protocol::git::{GitDiffLineType, GitFileStatus, GitRepoStatus};
use tauri::async_runtime::block_on;

fn status_of(cwd: &str) -> GitRepoStatus {
    block_on(git_status(cwd.to_string())).expect("status of a temp repository")
}

fn file_status(status: &GitRepoStatus, path: &str) -> Option<(GitFileStatus, GitFileStatus)> {
    status
        .files
        .iter()
        .find(|file| file.path == path)
        .map(|file| (file.staged, file.unstaged))
}

#[test]
fn working_tree_commands_stage_unstage_commit_and_revert() {
    let _guard = test_support::lock();
    let _env = ScrubbedGitEnv::new();
    let (_temp, root) = repo_with_commit();
    let dir = cwd(&root);
    let paths = vec!["notes.txt".to_string()];

    write(&root, "notes.txt", "note one\n");
    let status = status_of(&dir);
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(
        file_status(&status, "notes.txt"),
        Some((GitFileStatus::Unmodified, GitFileStatus::Untracked))
    );
    let untracked = block_on(git_diff(dir.clone(), "notes.txt".into(), false)).expect("diff");
    assert!(untracked.hunks[0]
        .lines
        .iter()
        .any(|line| line.line_type == GitDiffLineType::Addition && line.content == "note one"));

    block_on(git_stage(dir.clone(), paths.clone())).expect("stage");
    assert_eq!(
        file_status(&status_of(&dir), "notes.txt"),
        Some((GitFileStatus::Added, GitFileStatus::Unmodified))
    );
    let staged = block_on(git_diff(dir.clone(), "notes.txt".into(), true)).expect("staged diff");
    assert_eq!(staged.path, "notes.txt");
    assert_eq!(staged.hunks.len(), 1);

    block_on(git_unstage(dir.clone(), paths.clone())).expect("unstage");
    assert_eq!(
        file_status(&status_of(&dir), "notes.txt"),
        Some((GitFileStatus::Unmodified, GitFileStatus::Untracked))
    );

    block_on(git_stage(dir.clone(), paths.clone())).expect("stage again");
    block_on(git_commit(dir.clone(), "  add notes  ".into(), false)).expect("commit");
    let log = block_on(git_log(dir.clone(), None, None)).expect("log");
    assert_eq!(log.len(), 2);
    assert_eq!(log[0].summary, "add notes");
    assert_eq!(log[0].parents, vec![log[1].id.clone()]);
    assert!(status_of(&dir).files.is_empty());

    let empty = block_on(git_commit(dir.clone(), "   ".into(), false));
    assert!(empty.is_err_and(|error| error.contains("empty")));
    block_on(git_commit(dir.clone(), "add notes, amended".into(), true)).expect("amend");
    let log = block_on(git_log(dir.clone(), Some(1), None)).expect("log after amend");
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].summary, "add notes, amended");
    assert_eq!(
        block_on(git_log(dir.clone(), None, None))
            .expect("full log")
            .len(),
        2
    );

    write(&root, "README.md", "edited\n");
    write(&root, "junk.txt", "junk\n");
    // Separate calls: `git restore` rejects the whole list when any path is untracked.
    block_on(git_revert(dir.clone(), vec!["README.md".into()])).expect("revert tracked");
    block_on(git_revert(dir.clone(), vec!["junk.txt".into()])).expect("revert untracked");
    assert_eq!(read(&root, "README.md"), "hello\n");
    assert!(!root.join("junk.txt").exists());

    // Empty path lists are no-ops rather than `git add --` with nothing after it.
    block_on(git_stage(dir.clone(), Vec::new())).expect("stage nothing");
    block_on(git_unstage(dir.clone(), Vec::new())).expect("unstage nothing");
    block_on(git_revert(dir.clone(), Vec::new())).expect("revert nothing");
    assert!(status_of(&dir).files.is_empty());
}

#[test]
fn file_commands_read_write_blame_history_and_delete() {
    let _guard = test_support::lock();
    let _env = ScrubbedGitEnv::new();
    let (_temp, root) = repo_with_commit();
    let dir = cwd(&root);
    let file = "src/lib.txt".to_string();

    block_on(git_write_file(
        dir.clone(),
        file.clone(),
        "one\ntwo\n".into(),
    ))
    .expect("write");
    assert_eq!(read(&root, &file), "one\ntwo\n");
    assert_eq!(
        block_on(git_read_file(dir.clone(), file.clone())).expect("read"),
        "one\ntwo\n"
    );
    for escape in ["../outside.txt", "/etc/passwd"] {
        assert!(block_on(git_read_file(dir.clone(), escape.into())).is_err());
        assert!(block_on(git_write_file(dir.clone(), escape.into(), "x".into())).is_err());
        assert!(block_on(git_read_file_revision(
            dir.clone(),
            escape.into(),
            "HEAD".into()
        ))
        .is_err());
    }
    assert!(block_on(git_read_file(dir.clone(), "missing.txt".into())).is_err());

    let first = commit_file(&root, &file, "one\ntwo\n", "add lib");
    assert_eq!(
        block_on(git_read_file_revision(
            dir.clone(),
            file.clone(),
            "HEAD".into()
        ))
        .expect("read HEAD revision"),
        "one\ntwo\n"
    );
    let blame = block_on(git_blame(dir.clone(), file.clone())).expect("blame");
    assert_eq!(blame.len(), 2);
    assert_eq!((blame[0].line_no, blame[0].content.as_str()), (1, "one"));
    assert_eq!((blame[1].line_no, blame[1].content.as_str()), (2, "two"));
    assert!(blame
        .iter()
        .all(|line| first.starts_with(line.commit.trim_start_matches('^'))));
    assert!(block_on(git_blame(dir.clone(), "missing.txt".into())).is_err());

    let second = commit_file(&root, &file, "one\ndeux\n", "translate line two");
    let history = block_on(git_file_history(
        dir.clone(),
        file.clone(),
        None,
        None,
        None,
    ))
    .expect("file history");
    let ids: Vec<_> = history
        .iter()
        .map(|entry| entry.commit.id.as_str())
        .collect();
    assert_eq!(ids, vec![second.as_str(), first.as_str()]);
    assert!(history.iter().all(|entry| entry.path == file));
    let line_two = block_on(git_file_history(
        dir.clone(),
        file.clone(),
        Some(2),
        Some(2),
        Some(1),
    ))
    .expect("line history");
    assert_eq!(line_two.len(), 1);
    assert_eq!(line_two[0].commit.summary, "translate line two");
    assert!(block_on(git_file_history(
        dir.clone(),
        file.clone(),
        Some(3),
        Some(1),
        None
    ))
    .is_err());

    let against_parent = block_on(git_diff_branch(dir.clone(), file.clone(), "HEAD~1".into()))
        .expect("diff against a revision");
    let lines = &against_parent.hunks[0].lines;
    assert!(lines
        .iter()
        .any(|line| line.line_type == GitDiffLineType::Deletion && line.content == "two"));
    assert!(lines
        .iter()
        .any(|line| line.line_type == GitDiffLineType::Addition && line.content == "deux"));
    assert!(block_on(git_diff_branch(
        dir.clone(),
        file.clone(),
        "no-such-ref".into()
    ))
    .is_err());

    block_on(git_delete_file(dir.clone(), file.clone())).expect("delete tracked file");
    assert!(!root.join(&file).exists());
    assert_eq!(
        file_status(&status_of(&dir), &file),
        Some((GitFileStatus::Deleted, GitFileStatus::Unmodified))
    );
    // `git rm` refuses untracked files, so the command falls back to removing them from disk.
    write(&root, "loose/scratch.txt", "scratch\n");
    block_on(git_delete_file(dir.clone(), "loose/scratch.txt".into())).expect("delete loose file");
    assert!(!root.join("loose/scratch.txt").exists());
    block_on(git_delete_file(dir.clone(), "never-existed.txt".into())).expect("delete nothing");
}

#[test]
fn branch_commands_create_checkout_compare_merge_and_delete() {
    let _guard = test_support::lock();
    let _env = ScrubbedGitEnv::new();
    let (_temp, root) = repo_with_commit();
    let dir = cwd(&root);

    block_on(git_create_branch(
        dir.clone(),
        "feature".into(),
        None,
        false,
    ))
    .expect("branch");
    let branches = block_on(git_branches(dir.clone())).expect("branches");
    let feature = branches
        .iter()
        .find(|branch| branch.name == "feature")
        .expect("feature branch listed");
    assert!(!feature.is_current && !feature.is_remote);
    assert!(branches
        .iter()
        .any(|branch| branch.name == "main" && branch.is_current));

    block_on(git_create_branch(
        dir.clone(),
        "topic".into(),
        Some("main".into()),
        true,
    ))
    .expect("create and check out topic");
    assert_eq!(status_of(&dir).branch.as_deref(), Some("topic"));
    let topic_commit = commit_file(&root, "topic.txt", "topic\n", "topic work");
    assert!(block_on(git_create_branch(dir.clone(), "topic".into(), None, false)).is_err());

    let comparison = block_on(git_compare_branches(
        dir.clone(),
        "main".into(),
        "topic".into(),
    ))
    .expect("compare");
    assert_eq!(comparison.base_branch, "main");
    assert_eq!(comparison.target_branch, "topic");
    assert_eq!(comparison.commits_ahead.len(), 1);
    assert_eq!(comparison.commits_ahead[0].id, topic_commit);
    assert!(comparison.commits_behind.is_empty());
    assert_eq!(comparison.files.len(), 1);
    assert_eq!(comparison.files[0].path, "topic.txt");
    assert_eq!(comparison.files[0].staged, GitFileStatus::Added);
    assert!(block_on(git_compare_branches(
        dir.clone(),
        "main".into(),
        "nope".into()
    ))
    .is_err());

    block_on(git_checkout(dir.clone(), "main".into())).expect("checkout main");
    assert_eq!(status_of(&dir).branch.as_deref(), Some("main"));
    assert!(!root.join("topic.txt").exists());
    assert!(block_on(git_checkout(dir.clone(), "does-not-exist".into())).is_err());

    block_on(git_merge(dir.clone(), "topic".into())).expect("merge topic");
    assert_eq!(head(&root), topic_commit);
    assert_eq!(read(&root, "topic.txt"), "topic\n");
    assert!(block_on(git_merge(dir.clone(), "does-not-exist".into())).is_err());

    let result = block_on(git_delete_branches(
        dir.clone(),
        vec![
            "topic".into(),
            " ".into(),
            "feature".into(),
            "main".into(),
            "missing".into(),
        ],
        false,
        None,
    ))
    .expect("delete branches");
    assert_eq!(result.deleted, vec!["topic", "feature"]);
    let failed: Vec<_> = result.failed.iter().map(|f| f.branch.as_str()).collect();
    assert_eq!(failed, vec!["main", "missing"]);
    assert!(result.failed[0].reason.contains("currently checked out"));
    let remaining = block_on(git_branches(dir.clone())).expect("branches after delete");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].name, "main");
}

#[test]
fn rebase_and_cherry_pick_replay_commits_onto_the_current_branch() {
    let _guard = test_support::lock();
    let _env = ScrubbedGitEnv::new();
    let (_temp, root) = repo_with_commit();
    let dir = cwd(&root);

    git(&root, &["checkout", "-q", "-b", "side"]);
    commit_file(&root, "side.txt", "side\n", "side work");
    git(&root, &["checkout", "-q", "main"]);
    let main_tip = commit_file(&root, "main.txt", "main\n", "main work");
    git(&root, &["checkout", "-q", "side"]);

    block_on(git_rebase(dir.clone(), "main".into())).expect("rebase side onto main");
    let log = block_on(git_log(dir.clone(), Some(2), None)).expect("log after rebase");
    assert_eq!(log[0].summary, "side work");
    assert_eq!(log[0].parents, vec![main_tip.clone()]);
    assert_eq!(read(&root, "main.txt"), "main\n");
    assert!(block_on(git_rebase(dir.clone(), "does-not-exist".into())).is_err());

    let extra = commit_file(&root, "extra.txt", "extra\n", "extra work");
    git(&root, &["checkout", "-q", "main"]);
    let message = block_on(git_cherry_pick(dir.clone(), format!(" {extra} ")))
        .expect("cherry-pick onto main");
    assert!(!message.is_empty());
    assert_eq!(read(&root, "extra.txt"), "extra\n");
    let log = block_on(git_log(dir.clone(), Some(1), None)).expect("log after cherry-pick");
    assert_eq!(log[0].summary, "extra work");
    assert_eq!(log[0].parents, vec![main_tip]);

    let blank = block_on(git_cherry_pick(dir.clone(), "   ".into()));
    assert!(blank.is_err_and(|error| error.contains("empty")));
    assert!(block_on(git_cherry_pick(dir.clone(), "0123456789abcdef".into())).is_err());
}
