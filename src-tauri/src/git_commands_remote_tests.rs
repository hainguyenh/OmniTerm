//! The Git command endpoints driven directly against disposable repositories: stashes, remotes
//! (a local bare `origin`, so nothing reaches the network), `git init`, and missing directories.

use crate::git_commands::*;
use crate::git_commands_tests::repo::{
    commit_file, configure, cwd, git, head, init_repo, read, repo_with_commit, write,
    ScrubbedGitEnv,
};
use crate::test_support;
use std::path::{Path, PathBuf};
use tauri::async_runtime::block_on;
use tempfile::TempDir;

fn stash_messages(dir: &str) -> Vec<String> {
    block_on(git_stash_list(dir.to_string()))
        .expect("stash list")
        .into_iter()
        .map(|entry| entry.message)
        .collect()
}

#[test]
fn stash_commands_save_list_apply_pop_and_drop() {
    let _guard = test_support::lock();
    let _env = ScrubbedGitEnv::new();
    let (_temp, root) = repo_with_commit();
    let dir = cwd(&root);
    assert!(stash_messages(&dir).is_empty());

    write(&root, "README.md", "first\n");
    block_on(git_stash_save(
        dir.clone(),
        Some(" first stash ".into()),
        false,
    ))
    .expect("save");
    assert_eq!(read(&root, "README.md"), "hello\n");
    write(&root, "README.md", "second\n");
    block_on(git_stash_save(dir.clone(), None, true)).expect("save with keep-index");
    assert_eq!(read(&root, "README.md"), "hello\n");

    let entries = block_on(git_stash_list(dir.clone())).expect("stash entries");
    assert_eq!(entries.len(), 2);
    assert_eq!(
        (entries[0].index, entries[0].name.as_str()),
        (0, "stash@{0}")
    );
    assert_eq!(
        (entries[1].index, entries[1].name.as_str()),
        (1, "stash@{1}")
    );
    assert!(entries[1].message.contains("first stash"));
    assert!(!entries[0].message.contains("first stash"));

    block_on(git_stash_apply(dir.clone(), Some(1))).expect("apply the older stash");
    assert_eq!(read(&root, "README.md"), "first\n");
    assert_eq!(stash_messages(&dir).len(), 2);
    block_on(git_revert(dir.clone(), vec!["README.md".into()])).expect("discard applied stash");

    block_on(git_stash_drop(dir.clone(), 0)).expect("drop newest");
    let remaining = stash_messages(&dir);
    assert_eq!(remaining.len(), 1);
    assert!(remaining[0].contains("first stash"));

    block_on(git_stash_pop(dir.clone(), None)).expect("pop");
    assert_eq!(read(&root, "README.md"), "first\n");
    assert!(stash_messages(&dir).is_empty());

    assert!(block_on(git_stash_pop(dir.clone(), Some(0))).is_err());
    assert!(block_on(git_stash_apply(dir.clone(), None)).is_err());
    assert!(block_on(git_stash_drop(dir.clone(), 3)).is_err());

    // With the working tree clean again, `stash push` succeeds without creating an entry.
    block_on(git_revert(dir.clone(), vec!["README.md".into()])).expect("clean tree");
    block_on(git_stash_save(dir.clone(), Some("   ".into()), false)).expect("save nothing");
    assert!(stash_messages(&dir).is_empty());
}

/// A bare repository at `<temp>/origin.git` with hooks disabled.
fn bare_origin(temp: &Path) -> PathBuf {
    let origin = temp.join("origin.git");
    std::fs::create_dir_all(&origin).expect("create origin directory");
    git(&origin, &["init", "-q", "--bare", "-b", "main"]);
    git(&origin, &["config", "core.hooksPath", "no-hooks"]);
    origin
}

#[test]
fn remote_commands_push_fetch_and_pull_through_a_local_origin() {
    let _guard = test_support::lock();
    let _env = ScrubbedGitEnv::new();
    let (_temp, root) = repo_with_commit();
    let dir = cwd(&root);
    let base = root.parent().expect("repo has a parent").to_path_buf();
    let origin = bare_origin(&base);
    git(&root, &["remote", "add", "origin", &cwd(&origin)]);

    block_on(git_push(dir.clone(), true)).expect("push with upstream");
    let status = block_on(git_status(dir.clone())).expect("status after push");
    assert_eq!(status.upstream.as_deref(), Some("origin/main"));
    assert_eq!((status.ahead, status.behind), (0, 0));

    let clone = base.join("clone");
    git(&base, &["clone", "-q", &cwd(&origin), "clone"]);
    configure(&clone);
    commit_file(&clone, "from-clone.txt", "one\n", "clone work");
    git(&clone, &["push", "-q", "origin", "main"]);

    block_on(git_fetch(dir.clone(), true)).expect("fetch with prune");
    let status = block_on(git_status(dir.clone())).expect("status after fetch");
    assert_eq!((status.ahead, status.behind), (0, 1));
    assert!(!root.join("from-clone.txt").exists());

    block_on(git_pull(dir.clone(), false)).expect("merge pull");
    assert_eq!(read(&root, "from-clone.txt"), "one\n");
    assert_eq!(head(&root), head(&clone));

    let remote_tip = commit_file(&clone, "second.txt", "two\n", "more clone work");
    git(&clone, &["push", "-q", "origin", "main"]);
    block_on(git_pull(dir.clone(), true)).expect("rebase pull");
    assert_eq!(head(&root), remote_tip);

    let local_tip = commit_file(&root, "local.txt", "local\n", "local work");
    let up_to_date = block_on(git_fetch(dir.clone(), false)).expect("fetch with nothing new");
    assert_eq!(up_to_date, "Fetch completed successfully");
    block_on(git_push(dir.clone(), false)).expect("push to the tracked upstream");
    assert_eq!(git(&origin, &["rev-parse", "main"]).trim(), local_tip);
    let branches = block_on(git_branches(dir.clone())).expect("branches with a remote");
    assert!(branches
        .iter()
        .any(|branch| branch.is_remote && branch.name == "origin/main"));

    // A repository without a remote fails each network command instead of hanging.
    let lonely = base.join("lonely");
    init_repo(&lonely);
    commit_file(&lonely, "a.txt", "a\n", "lonely work");
    let lonely = cwd(&lonely);
    assert!(block_on(git_push(lonely.clone(), true)).is_err());
    assert!(block_on(git_pull(lonely, false)).is_err());
}

#[test]
fn git_init_creates_a_repository_in_an_empty_directory() {
    let _guard = test_support::lock();
    let _env = ScrubbedGitEnv::new();
    let temp = TempDir::new().expect("temp dir");
    let fresh = temp.path().join("fresh");
    std::fs::create_dir_all(&fresh).expect("create directory");

    let message = block_on(git_init(cwd(&fresh))).expect("init");
    assert!(
        message.contains("Initialized"),
        "unexpected output: {message}"
    );
    assert!(fresh.join(".git").is_dir());
    let status = block_on(git_status(cwd(&fresh))).expect("status of the new repository");
    assert!(status.files.is_empty());
    assert!(block_on(git_init(cwd(&temp.path().join("absent")))).is_err());
}

#[test]
fn every_repository_command_rejects_a_missing_directory() {
    let _guard = test_support::lock();
    let _env = ScrubbedGitEnv::new();
    let temp = TempDir::new().expect("temp dir");
    let gone = cwd(&temp.path().join("gone"));
    let s = || gone.clone();
    let file = || "a.txt".to_string();
    let errors = [
        block_on(git_status(s())).err(),
        block_on(git_diff(s(), file(), false)).err(),
        block_on(git_stage(s(), vec![file()])).err(),
        block_on(git_unstage(s(), vec![file()])).err(),
        block_on(git_revert(s(), vec![file()])).err(),
        block_on(git_log(s(), None, None)).err(),
        block_on(git_commit_details(s(), "abc".into())).err(),
        block_on(git_branches(s())).err(),
        block_on(git_checkout(s(), "main".into())).err(),
        block_on(git_create_branch(s(), "b".into(), None, false)).err(),
        block_on(git_delete_branches(s(), vec!["b".into()], true, None)).err(),
        block_on(git_fetch(s(), false)).err(),
        block_on(git_pull(s(), false)).err(),
        block_on(git_push(s(), false)).err(),
        block_on(git_merge(s(), "main".into())).err(),
        block_on(git_rebase(s(), "main".into())).err(),
        block_on(git_diff_branch(s(), file(), "main".into())).err(),
        block_on(git_blame(s(), file())).err(),
        block_on(git_delete_file(s(), file())).err(),
        block_on(git_read_file(s(), file())).err(),
        block_on(git_read_file_revision(s(), file(), "HEAD".into())).err(),
        block_on(git_write_file(s(), file(), "x".into())).err(),
        block_on(git_compare_branches(s(), "a".into(), "b".into())).err(),
        block_on(git_stash_list(s())).err(),
        block_on(git_stash_save(s(), None, false)).err(),
        block_on(git_stash_pop(s(), None)).err(),
        block_on(git_stash_apply(s(), None)).err(),
        block_on(git_stash_drop(s(), 0)).err(),
        block_on(git_cherry_pick(s(), "abc".into())).err(),
        block_on(git_file_history(s(), file(), None, None, None)).err(),
    ];
    for (index, error) in errors.iter().enumerate() {
        let error = error
            .as_deref()
            .unwrap_or_else(|| panic!("command #{index} accepted a missing directory"));
        assert!(
            error.contains("does not exist"),
            "command #{index}: {error}"
        );
    }
    assert!(!temp.path().join("gone").exists());
}
