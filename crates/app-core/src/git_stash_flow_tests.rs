//! End-to-end coverage of stashing, cherry-picking, branch comparison, branch maintenance tools and
//! file history edge cases, each test against its own disposable repository.

use std::path::Path;

use app_protocol::git::GitFileStatus;

use crate::git::{
    add_worktree, cherry_pick, compare_branches, default_worktree_path, file_context,
    get_file_history, get_repo_status, rename_branch, set_branch_upstream, stash_apply, stash_drop,
    stash_list, stash_pop, stash_save, update_branch_without_checkout,
};
use crate::git_test_repo::{commit_in, git_in, TestRepo};

#[test]
fn stash_commands_fail_cleanly_without_entries_or_repository() {
    let repo = TestRepo::new();
    assert!(stash_list(&repo.root).expect("empty list").is_empty());
    let nothing = stash_save(&repo.root, Some("idle"), false).expect("nothing to save");
    assert!(nothing.contains("No local changes"), "{nothing}");
    assert!(stash_list(&repo.root).expect("still empty").is_empty());

    assert!(stash_pop(&repo.root, None).is_err());
    assert!(stash_apply(&repo.root, Some(0)).is_err());
    assert!(stash_drop(&repo.root, 0).is_err());

    let plain = repo.base().join("plain");
    std::fs::create_dir(&plain).expect("plain dir");
    assert!(stash_list(&plain).is_err());
}

#[test]
fn stash_save_apply_pop_and_drop_round_trip() {
    let repo = TestRepo::new();
    repo.write("a.txt", "first stash\n");
    stash_save(&repo.root, Some("  named  "), false).expect("save named");
    assert_eq!(repo.read("a.txt"), "one\ntwo\nthree\n", "worktree reset");
    repo.write("a.txt", "second stash\n");
    stash_save(&repo.root, Some("   "), false).expect("save unnamed");

    let list = stash_list(&repo.root).expect("list");
    assert_eq!(list.len(), 2);
    assert_eq!((list[0].index, list[0].name.as_str()), (0, "stash@{0}"));
    assert!(list[0].message.starts_with("WIP on main"), "{:?}", list[0]);
    assert_eq!(list[1].message, "On main: named");
    assert!(list[1].timestamp.is_some());

    stash_apply(&repo.root, Some(1)).expect("apply older");
    assert_eq!(repo.read("a.txt"), "first stash\n");
    assert_eq!(
        stash_list(&repo.root).expect("list").len(),
        2,
        "apply keeps it"
    );
    repo.git(&["checkout", "--", "a.txt"]);

    stash_pop(&repo.root, None).expect("pop latest");
    assert_eq!(repo.read("a.txt"), "second stash\n");
    repo.git(&["checkout", "--", "a.txt"]);

    stash_apply(&repo.root, None).expect("apply latest");
    assert_eq!(repo.read("a.txt"), "first stash\n");
    repo.git(&["checkout", "--", "a.txt"]);

    stash_drop(&repo.root, 0).expect("drop");
    assert!(stash_list(&repo.root).expect("list").is_empty());
    assert!(stash_drop(&repo.root, 5).is_err());
}

#[test]
fn stash_keep_index_and_conflicting_pop() {
    let repo = TestRepo::new();
    repo.write("staged.txt", "staged\n");
    repo.git(&["add", "staged.txt"]);
    stash_save(&repo.root, None, true).expect("keep index");
    let status = get_repo_status(&repo.root).expect("status");
    assert_eq!(status.files.len(), 1);
    assert_eq!(status.files[0].staged, GitFileStatus::Added);
    repo.git(&["commit", "-q", "-m", "commit staged"]);

    repo.write("a.txt", "stashed\n");
    stash_save(&repo.root, Some("edit a"), false).expect("save");
    repo.commit_file("a.txt", "committed\n", "conflicting edit");
    assert!(stash_pop(&repo.root, Some(0)).is_err());
    assert_eq!(
        stash_list(&repo.root).expect("list").len(),
        2,
        "a conflicting pop keeps the entry beside the keep-index one"
    );
}

#[test]
fn cherry_pick_applies_commits_and_reports_failures() {
    let repo = TestRepo::new();
    assert!(cherry_pick(&repo.root, "  ")
        .unwrap_err()
        .contains("cannot be empty"));
    assert!(cherry_pick(&repo.root, "deadbeef").is_err());

    repo.git(&["checkout", "-q", "-b", "topic"]);
    let pick = repo.commit_file("p.txt", "p\n", "pick me");
    let clash = repo.commit_file("a.txt", "topic\n", "clash");
    repo.git(&["checkout", "-q", "main"]);

    let out = cherry_pick(&repo.root, &format!(" {pick} ")).expect("cherry-pick");
    assert!(out.contains("pick me"), "{out}");
    assert_eq!(repo.read("p.txt"), "p\n");

    repo.commit_file("a.txt", "main\n", "main edit");
    assert!(cherry_pick(&repo.root, &clash).is_err());
    assert_eq!(
        get_repo_status(&repo.root).expect("status").conflict_count,
        1
    );
}

#[test]
fn compare_branches_lists_commits_and_changed_files() {
    let repo = TestRepo::new();
    repo.commit_file("keep.txt", "k\n", "base files");
    repo.commit_file("old.txt", "rename me please\nline two\n", "add old");
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.git(&["mv", "old.txt", "new.txt"]);
    std::fs::remove_file(repo.root.join("keep.txt")).expect("delete");
    repo.write("a.txt", "changed\n");
    repo.write("added.txt", "added\n");
    repo.git(&["add", "-A"]);
    repo.git(&["commit", "-q", "-m", "feature work"]);
    repo.git(&["checkout", "-q", "main"]);
    repo.commit_file("main.txt", "m\n", "main only");

    let cmp = compare_branches(&repo.root, "main", "feature").expect("compare");
    assert_eq!(
        (cmp.base_branch.as_str(), cmp.target_branch.as_str()),
        ("main", "feature")
    );
    let ahead: Vec<&str> = cmp
        .commits_ahead
        .iter()
        .map(|c| c.summary.as_str())
        .collect();
    let behind: Vec<&str> = cmp
        .commits_behind
        .iter()
        .map(|c| c.summary.as_str())
        .collect();
    assert_eq!((ahead, behind), (vec!["feature work"], vec!["main only"]));
    assert_eq!(cmp.commits_ahead[0].parents.len(), 1);

    let mut files: Vec<(&str, Option<&str>, GitFileStatus)> = cmp
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.orig_path.as_deref(), f.staged))
        .collect();
    files.sort_by(|a, b| a.0.cmp(b.0));
    assert_eq!(
        files,
        vec![
            ("a.txt", None, GitFileStatus::Modified),
            ("added.txt", None, GitFileStatus::Added),
            ("keep.txt", None, GitFileStatus::Deleted),
            ("new.txt", Some("old.txt"), GitFileStatus::Renamed),
        ]
    );
    assert!(cmp.files.iter().all(|f| !f.is_conflicted));

    let err = compare_branches(&repo.root, "main", "no-such-branch").unwrap_err();
    assert!(!err.is_empty());
}

#[test]
fn branch_tools_validate_names_and_upstreams() {
    let repo = TestRepo::new();
    repo.git(&["branch", "loose"]);
    assert!(rename_branch(&repo.root, "", "x")
        .unwrap_err()
        .contains("must not be empty"));
    assert!(rename_branch(&repo.root, "ghost", "x").is_err());
    let renamed = rename_branch(&repo.root, " loose ", "tidy").expect("rename");
    assert_eq!(renamed, "Renamed 'loose' to 'tidy'");

    let unset = set_branch_upstream(&repo.root, "tidy", Some("   ")).unwrap_err();
    assert!(unset.contains("upstream"), "blank means unset: {unset}");
    assert!(set_branch_upstream(&repo.root, "tidy", Some("origin/none")).is_err());
    assert!(set_branch_upstream(&repo.root, "bad..name", Some("main")).is_err());
}

#[test]
fn branch_tools_fast_forward_from_and_check_out_remote_branches() {
    let repo = TestRepo::new();
    let origin = repo.with_origin();
    repo.git(&["push", "-q", "origin", "main:shared"]);
    repo.git(&["branch", "-q", "--track", "shared", "origin/shared"]);

    let other = repo.clone_origin(&origin);
    git_in(&other, &["checkout", "-q", "shared"]);
    commit_in(&other, "s.txt", "s\n", "shared work");
    git_in(&other, &["push", "-q", "origin", "shared"]);

    let ff = update_branch_without_checkout(&repo.root, "shared").expect("fast-forward");
    assert_eq!(ff, "Fast-forwarded 'shared' to origin/shared");
    assert_eq!(
        repo.git(&["log", "-1", "--format=%s", "shared"]),
        "shared work"
    );

    repo.git(&["config", "branch.shared.remote", "nowhere"]);
    let err = update_branch_without_checkout(&repo.root, "shared").unwrap_err();
    assert!(!err.contains("diverged"), "{err}");

    git_in(&other, &["push", "-q", "origin", "shared:remote-only"]);
    repo.git(&["fetch", "-q", "origin"]);
    let path = add_worktree(&repo.root, "origin/remote-only", None).expect("remote worktree");
    assert!(Path::new(&path).ends_with("remote-only"));
    assert_eq!(
        repo.git(&["rev-parse", "--abbrev-ref", "remote-only@{upstream}"]),
        "origin/remote-only"
    );

    let explicit = repo.base().join("explicit-wt");
    let explicit_text = explicit.to_string_lossy().into_owned();
    repo.git(&["branch", "local-wt"]);
    let added = add_worktree(&repo.root, "local-wt", Some(&explicit_text)).expect("explicit");
    assert_eq!(added, explicit_text);
    assert_eq!(
        git_in(&explicit, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "local-wt"
    );
    assert!(add_worktree(&repo.root, "main", Some("-bad")).is_err());
    assert!(add_worktree(&repo.root, " ", None).is_err());

    // The local branch a remote checkout would create already exists.
    git_in(&other, &["push", "-q", "origin", "shared:taken"]);
    repo.git(&["fetch", "-q", "origin"]);
    repo.git(&["branch", "taken"]);
    let custom = repo.base().join("taken-wt").to_string_lossy().into_owned();
    assert!(add_worktree(&repo.root, "origin/taken", Some(&custom)).is_err());
    assert!(!Path::new(&custom).exists());
}

#[test]
fn default_worktree_path_falls_back_for_a_root_path() {
    let root = Path::new("/");
    assert_eq!(
        default_worktree_path(root, "a/b\\c"),
        Path::new("/").join("repo.worktrees").join("a-b-c")
    );
}

#[test]
fn file_context_and_history_reject_non_files_and_empty_paths() {
    assert!(file_context(Path::new("/"))
        .unwrap_err()
        .contains("not a file"));
    let repo = TestRepo::new();
    let context = file_context(&repo.root.join("a.txt")).expect("root-level file");
    assert_eq!(context.relative_path, "a.txt");
    assert!(get_file_history(&repo.root, "", None, 10)
        .unwrap_err()
        .contains("traversal"));
    assert!(get_file_history(&repo.root.join("missing"), "a.txt", None, 10).is_err());
}

#[test]
fn compare_branches_classifies_copies_and_type_changes() {
    let repo = TestRepo::new();
    let body = "a fairly long line that makes copy detection confident\n".repeat(8);
    repo.commit_file("src.txt", &body, "copy source");
    repo.git(&["config", "diff.renames", "copies"]);
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.write("src.txt", &format!("{body}tail\n"));
    repo.write("copy.txt", &body);
    // Stage `a.txt` as a symlink blob without needing symlink support on the host.
    let target = repo.base().join("link-target");
    std::fs::write(&target, "a-target").expect("write link target");
    let target_text = target.to_string_lossy().into_owned();
    let blob = repo.git(&["hash-object", "-w", &target_text]);
    repo.git(&["add", "src.txt", "copy.txt"]);
    let cacheinfo = format!("120000,{blob},a.txt");
    repo.git(&["update-index", "--cacheinfo", &cacheinfo]);
    repo.git(&["commit", "-q", "-m", "copy and retype"]);

    let cmp = compare_branches(&repo.root, "main", "feature").expect("compare");
    let files: Vec<(&str, GitFileStatus)> = cmp
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.staged))
        .collect();
    assert_eq!(files.len(), 3, "{files:?}");
    assert!(
        files.contains(&("a.txt", GitFileStatus::Modified)),
        "a type change reads as modified: {files:?}"
    );
    assert!(
        files.contains(&("src.txt", GitFileStatus::Modified)),
        "{files:?}"
    );
    // Only the classification is pinned: the path a `C` record reports is not asserted here.
    assert_eq!(
        files
            .iter()
            .filter(|(_, status)| *status == GitFileStatus::Copied)
            .count(),
        1,
        "{files:?}"
    );
}

#[test]
fn history_parser_skips_unnamed_lines_inside_line_range_patches() {
    let text = "\x1eaaa\x1fa\x1fedit\x1fDev\x1fd@x\x1f5\x1fp0\n\
                stray line\ndiff --git a/x.txt b/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n";
    let entries = crate::git_history::parse_file_history(text, "y.txt");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].path, "x.txt");
}
