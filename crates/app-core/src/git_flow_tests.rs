//! End-to-end coverage of the working-tree services in `git.rs` and `git_status.rs`, each test
//! against its own disposable repository.

use app_protocol::git::{GitFileChange, GitFileStatus};

use crate::git::{
    commit, delete_file, find_repo_root, get_commit_log, get_file_blame, get_repo_status,
    read_file_content, read_file_revision, revert_paths, stage_paths, unstage_paths,
    write_file_content,
};
use crate::git_test_repo::{commit_in, TestRepo};

fn paths(list: &[&str]) -> Vec<String> {
    list.iter().map(|p| p.to_string()).collect()
}

fn entry<'a>(files: &'a [GitFileChange], path: &str) -> &'a GitFileChange {
    files
        .iter()
        .find(|file| file.path == path)
        .unwrap_or_else(|| panic!("{path} missing from {files:?}"))
}

#[test]
fn services_reject_missing_and_non_repository_directories() {
    let repo = TestRepo::new();
    let missing = repo.base().join("missing");
    let err = get_repo_status(&missing).unwrap_err();
    assert!(err.contains("Directory does not exist"), "{err}");
    assert!(find_repo_root(&missing)
        .unwrap_err()
        .contains("Path does not exist"));

    let plain = repo.base().join("plain");
    std::fs::create_dir(&plain).expect("plain dir");
    let err = get_repo_status(&plain).unwrap_err();
    assert!(err.contains("not a git repository"), "{err}");
    assert!(find_repo_root(&plain).is_err());
    assert!(get_commit_log(&plain, 5, None).is_err());
}

#[test]
fn find_repo_root_resolves_subdirectories_files_and_bare_git_markers() {
    let repo = TestRepo::new();
    repo.write("nested/deep/file.txt", "x");
    assert_eq!(
        find_repo_root(&repo.root.join("nested/deep")).expect("from subdir"),
        repo.root
    );
    assert_eq!(
        find_repo_root(&repo.root.join("nested/deep/file.txt")).expect("from file"),
        repo.root
    );

    // git refuses an empty `.git` directory, so the walk-up fallback finds the marker itself.
    let marked = repo.base().join("marked");
    std::fs::create_dir_all(marked.join(".git")).expect("fake marker");
    std::fs::create_dir_all(marked.join("inner")).expect("inner dir");
    assert_eq!(
        find_repo_root(&marked.join("inner")).expect("fallback root"),
        marked
    );
}

#[test]
fn status_reports_every_kind_of_change() {
    let repo = TestRepo::new();
    repo.commit_file("gone.txt", "bye\n", "add gone");
    repo.commit_file("old name.txt", "rename me\n", "add rename source");

    repo.write("a.txt", "one\nTWO\nthree\n");
    repo.write("staged.txt", "new\n");
    stage_paths(&repo.root, &paths(&["staged.txt"])).expect("stage");
    std::fs::remove_file(repo.root.join("gone.txt")).expect("delete");
    repo.git(&["mv", "old name.txt", "new name.txt"]);
    repo.write("dir/untracked.txt", "?");

    let status = get_repo_status(&repo.root).expect("status");
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(status.upstream, None);
    assert!(!status.is_detached);
    assert_eq!(
        (status.ahead, status.behind, status.conflict_count),
        (0, 0, 0)
    );

    let modified = entry(&status.files, "a.txt");
    assert_eq!(modified.staged, GitFileStatus::Unmodified);
    assert_eq!(modified.unstaged, GitFileStatus::Modified);
    assert_eq!(
        entry(&status.files, "staged.txt").staged,
        GitFileStatus::Added
    );
    assert_eq!(
        entry(&status.files, "gone.txt").unstaged,
        GitFileStatus::Deleted
    );
    let renamed = entry(&status.files, "new name.txt");
    assert_eq!(renamed.staged, GitFileStatus::Renamed);
    assert_eq!(renamed.orig_path.as_deref(), Some("old name.txt"));
    assert_eq!(
        entry(&status.files, "dir/").unstaged,
        GitFileStatus::Untracked
    );

    // A path to a file inside the repository is accepted as the working directory.
    let from_file = get_repo_status(&repo.root.join("a.txt")).expect("status from file");
    assert_eq!(from_file.files.len(), status.files.len());
}

#[test]
fn status_reports_detached_head_unborn_branch_and_conflicts() {
    let empty = TestRepo::empty();
    let unborn = get_repo_status(&empty.root).expect("unborn status");
    assert_eq!(unborn.branch.as_deref(), Some("main"));
    assert!(unborn.files.is_empty());
    assert!(
        get_commit_log(&empty.root, 5, None).is_err(),
        "no commits yet"
    );
    drop(empty);

    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "--detach"]);
    let detached = get_repo_status(&repo.root).expect("detached status");
    assert!(detached.is_detached);
    assert_eq!(detached.branch, None);

    repo.git(&["checkout", "-q", "-b", "topic", "main"]);
    repo.commit_file("a.txt", "topic\n", "topic edit");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit_file("a.txt", "main\n", "main edit");
    assert!(crate::git::merge_branch(&repo.root, "topic").is_err());

    let conflicted = get_repo_status(&repo.root).expect("conflict status");
    assert_eq!(conflicted.conflict_count, 1);
    let file = entry(&conflicted.files, "a.txt");
    assert!(file.is_conflicted);
    assert_eq!(file.staged, GitFileStatus::Conflicted);
}

#[test]
fn status_reports_upstream_ahead_and_behind() {
    let repo = TestRepo::new();
    let origin = repo.with_origin();
    let other = repo.clone_origin(&origin);
    commit_in(&other, "remote.txt", "remote\n", "remote work");
    crate::git_test_repo::git_in(&other, &["push", "-q", "origin", "main"]);

    repo.commit_file("local.txt", "local\n", "local work");
    repo.git(&["fetch", "-q", "origin"]);

    let status = get_repo_status(&repo.root).expect("status");
    assert_eq!(status.upstream.as_deref(), Some("origin/main"));
    assert_eq!((status.ahead, status.behind), (1, 1));
}

#[test]
fn stage_unstage_and_revert_round_trip() {
    let repo = TestRepo::new();
    stage_paths(&repo.root, &[]).expect("empty stage is a no-op");
    unstage_paths(&repo.root, &[]).expect("empty unstage is a no-op");
    revert_paths(&repo.root, &[]).expect("empty revert is a no-op");

    repo.write("a.txt", "changed\n");
    repo.write("b.txt", "new\n");
    stage_paths(&repo.root, &paths(&["a.txt", "b.txt"])).expect("stage both");
    let staged = get_repo_status(&repo.root).expect("status");
    assert_eq!(
        entry(&staged.files, "a.txt").staged,
        GitFileStatus::Modified
    );
    assert_eq!(entry(&staged.files, "b.txt").staged, GitFileStatus::Added);

    unstage_paths(&repo.root, &paths(&["a.txt", "b.txt"])).expect("unstage both");
    let unstaged = get_repo_status(&repo.root).expect("status");
    assert_eq!(
        entry(&unstaged.files, "a.txt").unstaged,
        GitFileStatus::Modified
    );
    assert_eq!(
        entry(&unstaged.files, "b.txt").unstaged,
        GitFileStatus::Untracked
    );

    // Reverted one kind at a time: `git restore` rejects the whole list when it names an
    // untracked file, and `revert_paths` ignores that failure.
    revert_paths(&repo.root, &paths(&["a.txt"])).expect("revert tracked");
    revert_paths(&repo.root, &paths(&["b.txt"])).expect("remove untracked");
    assert_eq!(repo.read("a.txt"), "one\ntwo\nthree\n");
    assert!(!repo.root.join("b.txt").exists(), "untracked file removed");
    assert!(get_repo_status(&repo.root)
        .expect("status")
        .files
        .is_empty());

    let err = stage_paths(&repo.root, &paths(&["nope.txt"])).unwrap_err();
    assert!(err.contains("nope.txt"), "{err}");
    assert!(unstage_paths(&repo.root, &paths(&["nope.txt"])).is_err());
}

#[test]
fn commit_validates_message_creates_and_amends() {
    let repo = TestRepo::new();
    assert!(commit(&repo.root, "   ", false)
        .unwrap_err()
        .contains("cannot be empty"));
    // Nothing staged: git reports on stdout only, so the error names the failed command.
    let err = commit(&repo.root, "nothing", false).unwrap_err();
    assert!(err.contains("exit code"), "{err}");

    repo.write("b.txt", "b\n");
    stage_paths(&repo.root, &paths(&["b.txt"])).expect("stage");
    let out = commit(&repo.root, "  add b  ", false).expect("commit");
    assert!(out.contains("add b"), "{out}");

    commit(&repo.root, "add b, reworded", true).expect("amend");
    let log = get_commit_log(&repo.root, 10, None).expect("log");
    let summaries: Vec<&str> = log.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, vec!["add b, reworded", "initial"]);
    assert_eq!(log[0].parents, vec![log[1].id.clone()]);
    assert!(log[1].parents.is_empty());
    assert!(log[0].id.starts_with(&log[0].short_id));
    assert_eq!(log[0].author_name, "Dev");
    assert_eq!(log[0].author_email, "dev@example.test");
    assert!(log[0].timestamp > 0);

    assert_eq!(
        get_commit_log(&repo.root, 1, None).expect("limited").len(),
        1
    );
}

#[test]
fn commit_log_lists_merge_parents() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "topic"]);
    repo.commit_file("t.txt", "t\n", "topic work");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit_file("m.txt", "m\n", "main work");
    repo.git(&["merge", "-q", "--no-edit", "topic"]);

    let log = get_commit_log(&repo.root, 1, None).expect("log");
    assert_eq!(log[0].parents.len(), 2);
}

#[test]
fn blame_attributes_each_line_to_its_commit() {
    let repo = TestRepo::new();
    let first = repo.git(&["rev-parse", "--short=7", "HEAD"]);
    repo.commit_file("a.txt", "one\nTWO\nthree\n", "edit two");
    let second = repo.git(&["rev-parse", "--short=7", "HEAD"]);

    let lines = get_file_blame(&repo.root, "a.txt").expect("blame");
    let contents: Vec<&str> = lines.iter().map(|l| l.content.as_str()).collect();
    assert_eq!(contents, vec!["one", "TWO", "three"]);
    assert_eq!(
        lines.iter().map(|l| l.line_no).collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    assert!(lines[0].commit.trim_start_matches('^').starts_with(&first));
    assert!(lines[1].commit.starts_with(&second));

    assert!(get_file_blame(&repo.root, "missing.txt").is_err());
}

#[test]
fn blame_keeps_content_when_lines_come_from_a_renamed_file() {
    let repo = TestRepo::new();
    repo.git(&["mv", "a.txt", "b.txt"]);
    repo.git(&["commit", "-q", "-m", "rename"]);
    repo.commit_file("b.txt", "one\ntwo\nthree\nfour\n", "append");

    // Lines from before the rename carry the old file name in the blame meta column.
    let lines = get_file_blame(&repo.root, "b.txt").expect("blame");
    let contents: Vec<&str> = lines.iter().map(|l| l.content.as_str()).collect();
    assert_eq!(contents, vec!["one", "two", "three", "four"]);
}

#[test]
fn delete_file_handles_tracked_untracked_and_missing_paths() {
    let repo = TestRepo::new();
    delete_file(&repo.root, "a.txt").expect("tracked delete");
    assert!(!repo.root.join("a.txt").exists());
    let status = get_repo_status(&repo.root).expect("status");
    assert_eq!(entry(&status.files, "a.txt").staged, GitFileStatus::Deleted);

    repo.write("loose.txt", "x");
    delete_file(&repo.root, "loose.txt").expect("untracked file delete");
    assert!(!repo.root.join("loose.txt").exists());

    repo.write("loose_dir/inner/x.txt", "x");
    delete_file(&repo.root, "loose_dir").expect("untracked dir delete");
    assert!(!repo.root.join("loose_dir").exists());

    delete_file(&repo.root, "never.txt").expect("missing path is a no-op");
}

#[test]
fn file_content_helpers_read_write_and_reject_traversal() {
    let repo = TestRepo::new();
    for bad in ["../escape.txt", "/etc/passwd", "a\\..\\..\\escape.txt"] {
        assert_eq!(
            read_file_content(&repo.root, bad).unwrap_err(),
            "Invalid path traversal"
        );
        assert_eq!(
            write_file_content(&repo.root, bad, "x").unwrap_err(),
            "Invalid path traversal"
        );
        assert_eq!(
            read_file_revision(&repo.root, bad, "HEAD").unwrap_err(),
            "Invalid path traversal"
        );
    }

    write_file_content(&repo.root, "deep\\nested/new.txt", "hello").expect("write");
    assert_eq!(
        read_file_content(&repo.root, "deep/nested/new.txt").expect("read"),
        "hello"
    );
    assert!(read_file_content(&repo.root, "absent.txt")
        .unwrap_err()
        .contains("Failed to read file"));
    // `a.txt` is a file, so it cannot become a parent directory.
    assert!(write_file_content(&repo.root, "a.txt/child.txt", "x")
        .unwrap_err()
        .contains("Failed to create parent dirs"));
    assert!(write_file_content(&repo.root, "deep", "x")
        .unwrap_err()
        .contains("Failed to write file"));

    write_file_content(&repo.root, "a.txt", "edited\n").expect("overwrite");
    assert_eq!(
        read_file_revision(&repo.root, "a.txt", "HEAD").expect("HEAD blob"),
        "one\ntwo\nthree\n"
    );
    assert!(read_file_revision(&repo.root, "a.txt", "no-such-rev").is_err());
}
