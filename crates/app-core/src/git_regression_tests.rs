//! Regression tests for git service bugs found while covering the new git modules.

use crate::git::{get_file_blame, revert_paths};
use crate::git_branch::get_branches;
use crate::git_test_repo::TestRepo;

/// A clone's `refs/remotes/origin/HEAD` was shortened to a bare `origin` and listed as a local
/// branch of that name.
#[test]
fn a_clone_does_not_list_its_remote_head_as_a_local_origin_branch() {
    let repo = TestRepo::new();
    let origin = repo.with_origin();
    let clone = repo.clone_origin(&origin);

    let branches = get_branches(&clone).expect("branches of the clone");
    let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
    assert!(!names.contains(&"origin"), "fake branch listed: {names:?}");
    assert!(names.contains(&"main"), "{names:?}");
    let remote = branches
        .iter()
        .find(|b| b.name == "origin/main")
        .expect("remote tracking branch is listed");
    assert!(remote.is_remote);
}

/// One `git restore` over a mixed selection failed on the untracked path, and the error was
/// ignored, so the tracked file stayed modified while the untracked one was deleted.
#[test]
fn reverting_a_mixed_selection_restores_tracked_files_and_removes_untracked_ones() {
    let repo = TestRepo::new();
    repo.write("a.txt", "changed\n");
    repo.write("new.txt", "scratch\n");

    revert_paths(&repo.root, &["a.txt".to_string(), "new.txt".to_string()])
        .expect("revert succeeds");

    assert_eq!(repo.read("a.txt"), "one\ntwo\nthree\n");
    assert!(!repo.root.join("new.txt").exists());
}

/// `git blame -s` omits the author and date, so `author` was empty and `date` held the commit;
/// the content also lost its indentation.
#[test]
fn blame_reports_author_date_and_the_line_as_written() {
    let repo = TestRepo::new();
    let commit = repo.commit_file("code.rs", "fn main() {\n    run()\n}\n", "add code");

    let lines = get_file_blame(&repo.root, "code.rs").expect("blame");
    assert_eq!(lines.len(), 3);
    let second = &lines[1];
    assert!(commit.starts_with(second.commit.trim_start_matches('^')));
    assert_eq!(second.author, "Dev");
    let date: Vec<&str> = second.date.split('-').collect();
    assert_eq!(date.len(), 3, "short date, got {:?}", second.date);
    assert_eq!(second.content, "    run()");
    assert_eq!(second.line_no, 2);
}
