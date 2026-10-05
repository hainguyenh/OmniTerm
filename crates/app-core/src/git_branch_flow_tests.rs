//! End-to-end coverage of branch listing, switching, syncing with a file-path `origin`, merging,
//! rebasing and deleting, each test against its own disposable repositories.

use app_protocol::git::GitBranchInfo;

use crate::git::{
    checkout_branch, create_branch, delete_branches, fetch_repo, get_branches, get_repo_status,
    init_repo, merge_branch, pull_repo, push_repo, rebase_branch,
};
use crate::git_test_repo::{commit_in, git_in, TestRepo};

fn find<'a>(branches: &'a [GitBranchInfo], name: &str) -> &'a GitBranchInfo {
    branches
        .iter()
        .find(|b| b.name == name)
        .unwrap_or_else(|| panic!("{name} missing from {branches:?}"))
}

fn current(repo: &TestRepo) -> String {
    repo.git(&["rev-parse", "--abbrev-ref", "HEAD"])
}

#[test]
fn lists_local_branches_with_current_and_merged_flags() {
    let repo = TestRepo::new();
    repo.git(&["branch", "merged"]);
    repo.git(&["checkout", "-q", "-b", "wip"]);
    repo.commit_file("w.txt", "w\n", "wip work");
    repo.git(&["checkout", "-q", "main"]);

    let branches = get_branches(&repo.root).expect("branches");
    assert_eq!(branches.len(), 3);
    let main = find(&branches, "main");
    assert!(main.is_current && !main.is_remote && main.is_merged);
    assert_eq!(main.last_commit_message.as_deref(), Some("initial"));
    assert_eq!(main.last_commit_author.as_deref(), Some("Dev"));
    assert!(main.last_commit_timestamp.is_some_and(|t| t > 0));
    assert!(find(&branches, "merged").is_merged);
    let wip = find(&branches, "wip");
    assert!(!wip.is_current && !wip.is_merged);
    assert_eq!(wip.upstream, None);

    let plain = repo.base().join("plain");
    std::fs::create_dir(&plain).expect("plain dir");
    assert!(get_branches(&plain).is_err());
}

#[test]
fn lists_remote_branches_tracking_counts_and_gone_upstreams() {
    let repo = TestRepo::new();
    let origin = repo.with_origin();
    repo.git(&["push", "-q", "origin", "main:doomed"]);
    repo.git(&["branch", "-q", "--track", "doomed", "origin/doomed"]);

    let other = repo.clone_origin(&origin);
    commit_in(&other, "r.txt", "r\n", "remote work");
    git_in(&other, &["push", "-q", "origin", "main"]);
    git_in(&other, &["push", "-q", "origin", "--delete", "doomed"]);
    repo.commit_file("l.txt", "l\n", "local work");

    let fetched = fetch_repo(&repo.root, true).expect("fetch --prune");
    assert_eq!(fetched, "Fetch completed successfully");

    let branches = get_branches(&repo.root).expect("branches");
    let main = find(&branches, "main");
    assert_eq!(main.upstream.as_deref(), Some("origin/main"));
    assert_eq!((main.ahead, main.behind, main.is_gone), (1, 1, false));
    assert!(find(&branches, "origin/main").is_remote);
    assert!(find(&branches, "doomed").is_gone);
    assert!(!branches.iter().any(|b| b.name == "origin/doomed"));
}

#[test]
fn checkout_and_create_switch_branches_or_fail_cleanly() {
    let repo = TestRepo::new();
    let first = repo.head();
    repo.commit_file("b.txt", "b\n", "second");

    create_branch(&repo.root, "from-first", Some(&first), false).expect("branch at first");
    assert_eq!(current(&repo), "main", "plain create keeps the checkout");
    assert_eq!(repo.git(&["rev-parse", "from-first"]), first);

    create_branch(&repo.root, "feature/x", Some("  "), true).expect("create + checkout");
    assert_eq!(current(&repo), "feature/x");
    assert_eq!(
        repo.git(&["rev-parse", "feature/x"]),
        repo.git(&["rev-parse", "main"])
    );

    assert!(
        create_branch(&repo.root, "feature/x", None, false).is_err(),
        "duplicate"
    );
    assert!(create_branch(&repo.root, "bad..name", None, true).is_err());

    checkout_branch(&repo.root, "from-first").expect("checkout");
    assert_eq!(current(&repo), "from-first");
    assert!(!repo.root.join("b.txt").exists());

    checkout_branch(&repo.root, &first).expect("detach at commit");
    assert!(get_repo_status(&repo.root).expect("status").is_detached);

    let err = checkout_branch(&repo.root, "no-such-branch").unwrap_err();
    assert!(err.contains("no-such-branch"), "{err}");
}

#[test]
fn fetch_pull_and_push_sync_with_a_file_origin() {
    let repo = TestRepo::new();
    assert_eq!(
        fetch_repo(&repo.root, false).expect("fetch without remotes"),
        "Fetch completed successfully"
    );
    assert!(pull_repo(&repo.root, false).is_err(), "no upstream to pull");
    assert!(
        push_repo(&repo.root, false).is_err(),
        "no remote to push to"
    );

    let origin = repo.with_origin();
    let other = repo.clone_origin(&origin);
    commit_in(&other, "r.txt", "r\n", "remote one");
    git_in(&other, &["push", "-q", "origin", "main"]);

    let pulled = pull_repo(&repo.root, false).expect("fast-forward pull");
    assert!(!pulled.is_empty());
    assert_eq!(repo.read("r.txt"), "r\n");
    assert!(pull_repo(&repo.root, false)
        .expect("up to date")
        .to_lowercase()
        .contains("up to date"));

    commit_in(&other, "r2.txt", "r2\n", "remote two");
    git_in(&other, &["push", "-q", "origin", "main"]);
    repo.commit_file("l.txt", "l\n", "local one");
    pull_repo(&repo.root, true).expect("rebase pull");
    let log = repo.git(&["log", "--format=%s", "-3"]);
    assert_eq!(log, "local one\nremote two\nremote one");

    push_repo(&repo.root, false).expect("push");
    assert_eq!(
        git_in(&origin, &["rev-parse", "main"]),
        repo.head(),
        "origin received the rebased commit"
    );

    create_branch(&repo.root, "topic", None, true).expect("topic");
    repo.commit_file("t.txt", "t\n", "topic");
    push_repo(&repo.root, true).expect("push -u");
    assert_eq!(
        repo.git(&["rev-parse", "--abbrev-ref", "topic@{upstream}"]),
        "origin/topic"
    );

    git_in(&other, &["pull", "-q"]);
    commit_in(&other, "clash.txt", "remote\n", "remote clash");
    git_in(&other, &["push", "-q", "origin", "main"]);
    checkout_branch(&repo.root, "main").expect("back to main");
    repo.commit_file("clash.txt", "local\n", "local clash");
    let rejected = push_repo(&repo.root, false).unwrap_err();
    assert!(rejected.contains("rejected"), "{rejected}");

    repo.git(&["remote", "set-url", "origin", "does-not-exist.git"]);
    assert!(fetch_repo(&repo.root, false).is_err());
}

#[test]
fn merge_fast_forwards_and_reports_conflicts_and_unknown_refs() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "ff"]);
    repo.commit_file("ff.txt", "ff\n", "ff work");
    repo.git(&["checkout", "-q", "main"]);

    let merged = merge_branch(&repo.root, "ff").expect("fast-forward");
    assert!(merged.contains("Fast-forward"), "{merged}");
    assert_eq!(repo.head(), repo.git(&["rev-parse", "ff"]));

    assert!(merge_branch(&repo.root, "no-such-branch").is_err());

    repo.git(&["checkout", "-q", "-b", "side"]);
    repo.commit_file("a.txt", "side\n", "side edit");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit_file("a.txt", "main\n", "main edit");
    assert!(merge_branch(&repo.root, "side").is_err());
    assert_eq!(
        get_repo_status(&repo.root).expect("status").conflict_count,
        1
    );
}

#[test]
fn rebase_replays_commits_and_stops_on_conflicts() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "topic"]);
    repo.commit_file("t.txt", "t\n", "topic work");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit_file("m.txt", "m\n", "main work");
    repo.git(&["checkout", "-q", "topic"]);

    rebase_branch(&repo.root, "main").expect("clean rebase");
    assert_eq!(
        repo.git(&["log", "--format=%s", "-3"]),
        "topic work\nmain work\ninitial"
    );
    assert!(rebase_branch(&repo.root, "no-such-branch").is_err());

    repo.commit_file("a.txt", "topic\n", "topic edit");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit_file("a.txt", "main\n", "main edit");
    repo.git(&["checkout", "-q", "topic"]);
    assert!(rebase_branch(&repo.root, "main").is_err());
    assert!(get_repo_status(&repo.root).expect("status").conflict_count > 0);
}

#[test]
fn init_repo_creates_a_repository() {
    let repo = TestRepo::new();
    let fresh = repo.base().join("fresh");
    std::fs::create_dir(&fresh).expect("fresh dir");
    let out = init_repo(&fresh).expect("init");
    assert!(out.contains("Initialized empty Git repository"), "{out}");
    assert!(fresh.join(".git").is_dir());
    assert!(init_repo(&repo.base().join("missing")).is_err());
}

#[test]
fn delete_branches_reports_each_outcome() {
    let repo = TestRepo::new();
    repo.git(&["branch", "merged"]);
    repo.git(&["checkout", "-q", "-b", "unmerged"]);
    repo.commit_file("u.txt", "u\n", "unmerged work");
    repo.git(&["checkout", "-q", "main"]);

    let names: Vec<String> = ["main", "merged", "unmerged", "  ", "ghost"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let result = delete_branches(&repo.root, &names, false, false).expect("delete");
    assert_eq!(result.deleted, vec!["merged"]);
    let failed: Vec<&str> = result.failed.iter().map(|f| f.branch.as_str()).collect();
    assert_eq!(failed, vec!["main", "unmerged", "ghost"]);
    assert!(result.failed[0].reason.contains("currently checked out"));
    assert!(result.failed[1].reason.contains("not fully merged"));

    let forced =
        delete_branches(&repo.root, &["unmerged".to_string()], true, false).expect("force");
    assert_eq!(forced.deleted, vec!["unmerged"]);
    assert!(forced.failed.is_empty());
    assert!(repo.git(&["branch", "--list", "unmerged"]).is_empty());
}

#[test]
fn remote_branches_check_out_as_tracking_branches_whatever_the_remote_is_called() {
    let repo = TestRepo::new();
    let origin = repo.with_origin();
    let other = repo.clone_origin(&origin);
    git_in(&other, &["checkout", "-q", "-b", "feature/x"]);
    commit_in(&other, "x.txt", "x\n", "feature work");
    git_in(&other, &["push", "-q", "origin", "feature/x"]);
    repo.git(&["remote", "rename", "origin", "upstream"]);
    fetch_repo(&repo.root, false).expect("fetch");

    let branches = get_branches(&repo.root).expect("branches");
    assert!(find(&branches, "upstream/feature/x").is_remote);
    assert!(!find(&branches, "main").is_remote);

    checkout_branch(&repo.root, "upstream/feature/x").expect("checkout remote");
    assert_eq!(current(&repo), "feature/x");
    assert!(!get_repo_status(&repo.root).expect("status").is_detached);
    assert_eq!(
        repo.git(&["rev-parse", "--abbrev-ref", "feature/x@{upstream}"]),
        "upstream/feature/x"
    );

    checkout_branch(&repo.root, "main").expect("back to main");
    checkout_branch(&repo.root, "upstream/feature/x").expect("reuses the local branch");
    assert_eq!(current(&repo), "feature/x");
    assert!(checkout_branch(&repo.root, "--orphan").is_err());
}

#[test]
fn branches_checked_out_in_another_worktree_still_count_as_merged() {
    let repo = TestRepo::new();
    repo.git(&[
        "worktree",
        "add",
        "-q",
        "-b",
        "claude/agent",
        ".claude/worktrees/agent",
    ]);
    let branches = get_branches(&repo.root).expect("branches");
    assert!(find(&branches, "claude/agent").is_merged);
}
