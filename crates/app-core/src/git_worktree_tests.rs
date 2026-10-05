use super::*;
use crate::git::{add_worktree, get_repo_status};
use crate::git_test_repo::TestRepo;

#[test]
fn parses_main_linked_detached_and_flagged_worktrees() {
    let text = "worktree D:/repo\nHEAD 1111\nbranch refs/heads/main\n\n\
                worktree D:/repo/.claude/worktrees/agent\nHEAD 2222\nbranch refs/heads/claude/agent\nlocked agent busy\n\n\
                worktree D:/old\nHEAD 3333\ndetached\nprunable gitdir file points to non-existent location\n";
    let worktrees = parse_worktree_porcelain(text);
    assert_eq!(worktrees.len(), 3);

    assert_eq!(worktrees[0].path, "D:/repo");
    assert!(worktrees[0].is_main);
    assert_eq!(worktrees[0].branch.as_deref(), Some("main"));
    assert_eq!(worktrees[0].head.as_deref(), Some("1111"));

    assert!(!worktrees[1].is_main);
    assert_eq!(worktrees[1].branch.as_deref(), Some("claude/agent"));
    assert!(worktrees[1].is_locked);

    assert_eq!(worktrees[2].branch, None);
    assert!(worktrees[2].is_detached);
    assert!(worktrees[2].is_prunable);
    assert!(worktrees.iter().all(|worktree| !worktree.is_current));
}

#[test]
fn parses_a_bare_main_worktree_and_ignores_stray_lines() {
    let worktrees = parse_worktree_porcelain("stray\r\nworktree /srv/repo.git\r\nbare\r\n\r\n");
    assert_eq!(worktrees.len(), 1);
    assert!(worktrees[0].is_bare);
    assert!(worktrees[0].is_main);
    assert_eq!(worktrees[0].path, "/srv/repo.git");
    assert!(parse_worktree_porcelain("").is_empty());
}

#[test]
fn lists_worktrees_and_marks_the_one_asked_from() {
    let repo = TestRepo::new();
    repo.git(&["branch", "topic"]);
    let linked = PathBuf::from(add_worktree(&repo.root, "topic", None).expect("add worktree"));
    let linked = dunce::canonicalize(&linked).expect("canonical worktree");

    let from_main = list_worktrees(&repo.root).expect("list from main");
    assert_eq!(from_main.len(), 2);
    assert_eq!(PathBuf::from(&from_main[0].path), repo.root);
    assert!(from_main[0].is_main && from_main[0].is_current);
    assert_eq!(PathBuf::from(&from_main[1].path), linked);
    assert_eq!(from_main[1].branch.as_deref(), Some("topic"));
    assert!(!from_main[1].is_main && !from_main[1].is_current);

    let from_linked = list_worktrees(&linked).expect("list from linked");
    assert!(!from_linked[0].is_current);
    assert!(from_linked[1].is_current);
}

#[test]
fn status_names_the_main_worktree_only_inside_a_linked_one() {
    let repo = TestRepo::new();
    repo.git(&["branch", "topic"]);
    let linked = PathBuf::from(add_worktree(&repo.root, "topic", None).expect("add worktree"));

    assert_eq!(main_worktree_of(&repo.root), None);
    assert_eq!(
        get_repo_status(&repo.root)
            .expect("main status")
            .main_worktree,
        None
    );

    let status = get_repo_status(&linked).expect("linked status");
    assert_eq!(status.branch.as_deref(), Some("topic"));
    let main = status
        .main_worktree
        .expect("linked worktree names its main worktree");
    assert_eq!(PathBuf::from(main), repo.root);
}

#[test]
fn main_worktree_of_is_none_outside_a_repository() {
    let dir = tempfile::tempdir().expect("temp dir");
    let _guard = crate::test_support::lock();
    assert_eq!(main_worktree_of(dir.path()), None);
    assert!(list_worktrees(dir.path()).is_err());
}
