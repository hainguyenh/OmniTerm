use super::*;
use crate::git_test_repo::TestRepo;
use std::path::PathBuf;

/// Checks `branch` out into `.claude/worktrees/<name>`, the way Claude Code isolates an agent.
fn agent_worktree(repo: &TestRepo, name: &str, branch: &str) -> PathBuf {
    let rel = format!(".claude/worktrees/{name}");
    repo.git(&["worktree", "add", "-q", "-b", branch, &rel]);
    dunce::canonicalize(repo.root.join(rel)).expect("canonical worktree")
}

fn names(list: &[&str]) -> Vec<String> {
    list.iter().map(|name| name.to_string()).collect()
}

fn branch_exists(repo: &TestRepo, branch: &str) -> bool {
    !repo.git(&["branch", "--list", branch]).is_empty()
}

#[test]
fn a_worktree_branch_is_refused_until_its_worktree_may_go() {
    let repo = TestRepo::new();
    let worktree = agent_worktree(&repo, "agent", "claude/agent");

    let kept =
        delete_branches(&repo.root, &names(&["claude/agent"]), false, false).expect("delete");
    assert!(kept.deleted.is_empty());
    assert!(
        kept.failed[0].reason.contains("worktree"),
        "{:?}",
        kept.failed
    );
    assert!(worktree.is_dir());
    assert!(branch_exists(&repo, "claude/agent"));

    let gone = delete_branches(&repo.root, &names(&["claude/agent"]), false, true).expect("delete");
    assert_eq!(gone.deleted, vec!["claude/agent"]);
    assert!(gone.failed.is_empty());
    assert_eq!(gone.removed_worktrees.len(), 1);
    assert_eq!(PathBuf::from(&gone.removed_worktrees[0]), worktree);
    assert!(!worktree.exists());
    assert!(!branch_exists(&repo, "claude/agent"));
}

#[test]
fn unmerged_or_dirty_worktrees_survive_a_safe_delete_and_go_when_forced() {
    let repo = TestRepo::new();
    let unmerged = agent_worktree(&repo, "unmerged", "claude/unmerged");
    std::fs::write(unmerged.join("u.txt"), "u\n").expect("write");
    crate::git_test_repo::git_in(&unmerged, &["add", "-A"]);
    crate::git_test_repo::git_in(&unmerged, &["commit", "-q", "-m", "agent work"]);
    let dirty = agent_worktree(&repo, "dirty", "claude/dirty");
    std::fs::write(dirty.join("scratch.txt"), "draft\n").expect("write");
    let locked = agent_worktree(&repo, "locked", "claude/locked");
    repo.git(&["worktree", "lock", &locked.to_string_lossy()]);

    let targets = names(&["claude/unmerged", "claude/dirty", "claude/locked"]);
    let safe = delete_branches(&repo.root, &targets, false, true).expect("delete");
    assert!(safe.deleted.is_empty(), "{:?}", safe.deleted);
    assert!(safe.removed_worktrees.is_empty());
    assert!(safe.failed[0].reason.contains("not fully merged"));
    assert_eq!(safe.failed.len(), 3);
    assert!(unmerged.is_dir() && dirty.join("scratch.txt").is_file() && locked.is_dir());

    let forced = delete_branches(&repo.root, &targets, true, true).expect("force");
    assert_eq!(forced.deleted, targets);
    assert!(forced.failed.is_empty(), "{:?}", forced.failed);
    assert!(!unmerged.exists() && !dirty.exists() && !locked.exists());
}

#[test]
fn branches_checked_out_here_or_in_the_main_checkout_are_never_freed() {
    let repo = TestRepo::new();
    let worktree = agent_worktree(&repo, "agent", "claude/agent");

    let result =
        delete_branches(&worktree, &names(&["main", "claude/agent"]), true, true).expect("delete");
    assert!(result.deleted.is_empty());
    assert!(result.removed_worktrees.is_empty());
    assert!(result.failed[0].reason.contains("main checkout"));
    assert!(result.failed[1].reason.contains("currently checked out"));
    assert!(worktree.is_dir());
}

#[test]
fn a_missing_worktree_directory_no_longer_pins_its_branch() {
    let repo = TestRepo::new();
    let worktree = agent_worktree(&repo, "agent", "claude/agent");
    std::fs::remove_dir_all(&worktree).expect("remove worktree dir");

    let result =
        delete_branches(&repo.root, &names(&["claude/agent"]), false, false).expect("delete");
    assert_eq!(result.deleted, vec!["claude/agent"]);
    assert!(result.removed_worktrees.is_empty());
}

#[test]
fn option_like_names_are_rejected_before_reaching_git() {
    let repo = TestRepo::new();
    let result = delete_branches(&repo.root, &names(&["--all"]), true, true).expect("delete");
    assert!(result.deleted.is_empty());
    assert!(result.failed[0].reason.contains("'-'"));
}
