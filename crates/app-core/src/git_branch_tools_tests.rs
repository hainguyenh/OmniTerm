use super::*;
use std::process::Command;

/// Runs git in `dir` for test setup, panicking with git's stderr on failure.
fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new(crate::git::resolve_git_binary())
        .args(args)
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn commit(dir: &Path, file: &str, message: &str) {
    std::fs::write(dir.join(file), message).expect("write file");
    git(dir, &["add", file]);
    git(dir, &["commit", "-q", "-m", message]);
}

/// A repo on `main` with one commit, plus a `topic` branch that tracks `main` locally.
fn repo() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("temp dir");
    let root = dir.path().join("repo");
    std::fs::create_dir(&root).expect("repo dir");
    git(&root, &["init", "-q", "-b", "main"]);
    git(&root, &["config", "user.email", "dev@example.test"]);
    git(&root, &["config", "user.name", "Dev"]);
    git(&root, &["config", "commit.gpgsign", "false"]);
    commit(&root, "a.txt", "first");
    git(&root, &["branch", "--track", "topic", "main"]);
    (dir, root)
}

#[test]
fn fast_forwards_a_branch_that_is_not_checked_out() {
    let (_dir, root) = repo();
    commit(&root, "b.txt", "second");

    let message = update_branch_without_checkout(&root, "topic").expect("fast-forward");
    assert!(message.starts_with("Fast-forwarded 'topic'"), "{message}");
    assert_eq!(
        git(&root, &["rev-parse", "topic"]),
        git(&root, &["rev-parse", "main"])
    );
    assert_eq!(
        git(&root, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "main",
        "checkout is untouched"
    );

    let again = update_branch_without_checkout(&root, "topic").expect("no-op update");
    assert!(again.contains("already up to date"), "{again}");
}

#[test]
fn refuses_diverged_untracked_and_checked_out_branches() {
    let (_dir, root) = repo();
    git(&root, &["checkout", "-q", "topic"]);
    commit(&root, "t.txt", "topic work");
    git(&root, &["checkout", "-q", "main"]);
    commit(&root, "m.txt", "main work");
    let topic_before = git(&root, &["rev-parse", "topic"]);

    let diverged = update_branch_without_checkout(&root, "topic").unwrap_err();
    assert!(diverged.contains("diverged"), "{diverged}");
    assert_eq!(
        git(&root, &["rev-parse", "topic"]),
        topic_before,
        "a diverged branch is left alone"
    );

    git(&root, &["branch", "loose"]);
    assert!(update_branch_without_checkout(&root, "loose")
        .unwrap_err()
        .contains("no upstream"));
    assert!(update_branch_without_checkout(&root, "main")
        .unwrap_err()
        .contains("checked out"));
    assert!(update_branch_without_checkout(&root, "--upload-pack=x")
        .unwrap_err()
        .contains("'-'"));
}

#[test]
fn renames_branches_and_rejects_invalid_names() {
    let (_dir, root) = repo();
    rename_branch(&root, "topic", "feature/topic").expect("rename");
    assert!(git(&root, &["branch", "--list", "feature/topic"]).contains("feature/topic"));

    assert!(rename_branch(&root, "feature/topic", "bad..name")
        .unwrap_err()
        .contains("not a valid"));
    assert!(rename_branch(&root, "feature/topic", "-f").is_err());
    assert!(
        rename_branch(&root, "feature/topic", "main").is_err(),
        "existing names are refused"
    );
}

#[test]
fn sets_and_unsets_the_upstream() {
    let (_dir, root) = repo();
    git(&root, &["branch", "loose"]);

    let set = set_branch_upstream(&root, "loose", Some("main")).expect("set upstream");
    assert!(set.contains("now tracks main"), "{set}");
    assert_eq!(
        git(&root, &["rev-parse", "--abbrev-ref", "loose@{upstream}"]),
        "main"
    );

    set_branch_upstream(&root, "loose", None).expect("unset upstream");
    assert!(git_text(&root, &["rev-parse", "--abbrev-ref", "loose@{upstream}"]).is_err());
    assert!(set_branch_upstream(&root, "loose", Some("-x")).is_err());
}

#[test]
fn adds_worktrees_next_to_the_repository() {
    let (_dir, root) = repo();
    git(&root, &["branch", "feature/wt"]);

    let path = add_worktree(&root, "feature/wt", None).expect("add worktree");
    let expected = default_worktree_path(&root, "feature/wt");
    assert_eq!(PathBuf::from(&path), expected);
    assert!(expected.ends_with(Path::new("repo.worktrees").join("feature-wt")));
    assert_eq!(
        git(&expected, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "feature/wt"
    );

    assert!(add_worktree(&root, "feature/wt", None)
        .unwrap_err()
        .contains("already exists"));
    assert!(add_worktree(&root, "missing", None)
        .unwrap_err()
        .contains("Unknown branch"));
}
