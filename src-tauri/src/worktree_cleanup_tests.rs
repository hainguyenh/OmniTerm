use super::*;
use crate::worktree_cleanup::{base_branch, upstream_gone};
use ide_vcs::Branch;
use std::path::Path;
use std::process::Command;

static NOT_CANCELLED: AtomicBool = AtomicBool::new(false);

fn silent() -> Progress<'static> {
    Progress {
        on_step: &|_| {},
        cancel: &NOT_CANCELLED,
    }
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .current_dir(dir)
        .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
        .args(args)
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?} failed");
}

fn commit(dir: &Path, file: &str) {
    std::fs::write(dir.join(file), file).expect("write file");
    git(dir, &["add", file]);
    git(dir, &["commit", "-q", "-m", file]);
}

fn branch(name: &str, remote: bool, upstream: Option<&str>) -> Branch {
    Branch {
        name: name.to_string(),
        remote,
        current: false,
        upstream: upstream.map(str::to_string),
        ahead: 0,
        behind: 0,
        last_commit_ms: 0.0,
        commit: String::new(),
    }
}

/// A repository on `master` with three linked worktrees: `merged` (no commits of its own),
/// `work` (a commit of its own and an uncommitted file) and `gone` (its folder deleted).
struct Fixture {
    _dir: tempfile::TempDir,
    main: PathBuf,
    merged: PathBuf,
    work: PathBuf,
    gone: PathBuf,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("temp dir");
    let main = dir.path().join("repo");
    std::fs::create_dir(&main).expect("repo folder");
    git(&main, &["init", "-q", "-b", "master"]);
    commit(&main, "a.txt");
    let merged = dir.path().join("wt-merged");
    let work = dir.path().join("wt-work");
    let gone = dir.path().join("wt-gone");
    for (path, name) in [(&merged, "merged"), (&work, "work"), (&gone, "gone")] {
        let shown = path.to_string_lossy().into_owned();
        git(&main, &["worktree", "add", "-q", "-b", name, &shown]);
    }
    commit(&work, "b.txt");
    std::fs::write(work.join("draft.txt"), "draft").expect("untracked file");
    std::fs::remove_dir_all(&gone).expect("delete a worktree by hand");
    Fixture {
        _dir: dir,
        main,
        merged,
        work,
        gone,
    }
}

fn entry<'a>(found: &'a [crate::worktree_cleanup::Found], branch: &str) -> &'a WorktreeEntry {
    &found
        .iter()
        .find(|item| item.entry.branch.as_deref() == Some(branch))
        .unwrap_or_else(|| panic!("worktree {branch} listed"))
        .entry
}

#[test]
fn the_main_line_is_a_conventional_branch_else_the_main_tree_branch() {
    let branches = [
        branch("feature", false, None),
        branch("master", false, None),
    ];
    assert_eq!(
        base_branch(&branches, Some("feature")),
        Some("master".to_string())
    );
    assert_eq!(
        base_branch(&[branch("feature", false, None)], Some("feature")),
        Some("feature".to_string())
    );
}

#[test]
fn a_branch_whose_remote_branch_was_deleted_is_gone() {
    let tracked = branch("fix", false, Some("origin/fix"));
    let remote = branch("origin/fix", true, None);
    assert!(!upstream_gone(&tracked, &[tracked.clone(), remote]));
    assert!(upstream_gone(&tracked, std::slice::from_ref(&tracked)));
    assert!(!upstream_gone(&branch("local", false, None), &[]));
}

#[test]
fn scan_reports_the_facts_of_every_linked_worktree_once() {
    let repo = fixture();
    // The repository is reached through its main tree and through a worktree: listed once.
    let found = scan(&[repo.main.clone(), repo.merged.clone()], &silent());
    assert_eq!(found.len(), 3);

    let merged = entry(&found, "merged");
    assert_eq!(merged.base.as_deref(), Some("master"));
    assert!(merged.merged);
    assert_eq!(merged.changes, Some(0));
    assert!(!merged.missing);
    assert!(merged.bytes.is_some_and(|bytes| bytes > 0));
    assert_eq!(merged.repo_name, "repo");

    let work = entry(&found, "work");
    assert!(!work.merged);
    assert_eq!(work.changes, Some(1));
    assert!(work.last_active_ms > 0.0);

    let gone = entry(&found, "gone");
    assert!(gone.missing);
    assert_eq!(gone.changes, None);
    assert_eq!(gone.bytes, None);
}

fn known(repo: &Fixture, path: &Path, branch: &str, missing: bool) -> Result<Known, String> {
    Ok(Known {
        repo: repo.main.clone(),
        path: path.to_path_buf(),
        branch: Some(branch.to_string()),
        base: Some("master".to_string()),
        missing,
    })
}

#[test]
fn removal_prunes_missing_folders_and_deletes_only_merged_branches() {
    let repo = fixture();
    let chosen = vec![
        known(&repo, &repo.merged, "merged", false),
        known(&repo, &repo.gone, "gone", true),
        Err("C:/not/scanned".to_string()),
    ];
    let report = remove_all(chosen, false, true);
    assert_eq!(report.removed.len(), 2, "{report:?}");
    assert_eq!(report.deleted_branches, vec!["merged".to_string()]);
    assert_eq!(report.failed.len(), 1);
    assert!(!repo.merged.exists());
    let left = Repo::discover(&repo.main)
        .expect("open repo")
        .expect("a repo")
        .worktrees()
        .expect("list worktrees");
    assert_eq!(left.len(), 2, "main and work stay");
}

/// Uncommitted work is never removed without `force`, and an unmerged branch survives even then.
#[test]
fn removal_keeps_uncommitted_work_unless_forced() {
    let repo = fixture();
    let report = remove_all(vec![known(&repo, &repo.work, "work", false)], false, true);
    assert!(report.removed.is_empty());
    assert_eq!(report.failed.len(), 1);
    assert!(repo.work.join("draft.txt").exists());

    let report = remove_all(vec![known(&repo, &repo.work, "work", false)], true, true);
    assert_eq!(report.removed.len(), 1, "{report:?}");
    assert!(report.deleted_branches.is_empty());
    assert_eq!(report.kept_branches.len(), 1);
    assert!(!repo.work.exists());
}
