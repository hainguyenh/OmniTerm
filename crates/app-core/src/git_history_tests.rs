use super::*;
use std::path::PathBuf;
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

fn commit_all(dir: &Path, message: &str) {
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "-m", message]);
}

/// A repo on `main` whose `src/lib.txt` was created, edited at line 2, renamed, then edited at line 4.
fn repo() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("temp dir");
    let root = dunce::canonicalize(dir.path())
        .expect("canonical temp")
        .join("repo");
    std::fs::create_dir_all(root.join("src")).expect("repo dir");
    git(&root, &["init", "-q", "-b", "main"]);
    git(&root, &["config", "user.email", "dev@example.test"]);
    git(&root, &["config", "user.name", "Dev"]);
    git(&root, &["config", "commit.gpgsign", "false"]);
    std::fs::write(root.join("src/old.txt"), "one\ntwo\nthree\nfour\n").expect("write");
    commit_all(&root, "create");
    std::fs::write(root.join("src/old.txt"), "one\nTWO\nthree\nfour\n").expect("write");
    commit_all(&root, "edit line two");
    git(&root, &["mv", "src/old.txt", "src/new.txt"]);
    commit_all(&root, "rename");
    std::fs::write(root.join("src/new.txt"), "one\nTWO\nthree\nFOUR\n").expect("write");
    commit_all(&root, "edit line four");
    (dir, root)
}

fn summaries(entries: &[GitFileHistoryEntry]) -> Vec<(&str, &str)> {
    entries
        .iter()
        .map(|entry| (entry.commit.summary.as_str(), entry.path.as_str()))
        .collect()
}

#[test]
fn file_context_reports_root_relative_path_and_branch() {
    // Spawns git: PATH must not be swapped out by another test meanwhile.
    let _guard = crate::test_support::lock();
    let (_dir, root) = repo();
    let context = file_context(&root.join("src/new.txt")).expect("context");
    assert_eq!(PathBuf::from(&context.repo_root), root);
    assert_eq!(context.relative_path, "src/new.txt");
    assert_eq!(context.branch.as_deref(), Some("main"));

    git(&root, &["checkout", "-q", "--detach"]);
    let detached = file_context(&root.join("src/new.txt")).expect("detached context");
    assert_eq!(detached.branch, None);
}

#[test]
fn file_context_fails_outside_a_repository() {
    // Spawns git: PATH must not be swapped out by another test meanwhile.
    let _guard = crate::test_support::lock();
    let dir = tempfile::tempdir().expect("temp dir");
    let file = dir.path().join("loose.txt");
    std::fs::write(&file, "x").expect("write");
    assert!(file_context(&file).is_err());
}

#[test]
fn whole_file_history_follows_renames() {
    // Spawns git: PATH must not be swapped out by another test meanwhile.
    let _guard = crate::test_support::lock();
    let (_dir, root) = repo();
    let entries =
        get_file_history(&root, "src/new.txt", None, DEFAULT_HISTORY_LIMIT).expect("history");
    assert_eq!(
        summaries(&entries),
        vec![
            ("edit line four", "src/new.txt"),
            ("rename", "src/new.txt"),
            ("edit line two", "src/old.txt"),
            ("create", "src/old.txt"),
        ]
    );
    assert_eq!(entries[0].commit.parents.len(), 1);
    assert!(entries[3].commit.parents.is_empty());

    let limited = get_file_history(&root, "src/new.txt", None, 1).expect("limited");
    assert_eq!(limited.len(), 1);
}

#[test]
fn line_range_history_lists_only_commits_touching_the_range() {
    // Spawns git: PATH must not be swapped out by another test meanwhile.
    let _guard = crate::test_support::lock();
    let (_dir, root) = repo();
    let entries = get_file_history(&root, "src/new.txt", Some((2, 2)), DEFAULT_HISTORY_LIMIT)
        .expect("range history");
    assert_eq!(
        summaries(&entries),
        vec![("edit line two", "src/old.txt"), ("create", "src/old.txt")]
    );
}

#[test]
fn history_rejects_bad_paths_and_ranges() {
    // Spawns git: PATH must not be swapped out by another test meanwhile.
    let _guard = crate::test_support::lock();
    let (_dir, root) = repo();
    assert!(get_file_history(&root, "../x.txt", None, 10).is_err());
    assert!(get_file_history(&root, "/etc/passwd", None, 10).is_err());
    assert!(get_file_history(&root, "src/new.txt", Some((0, 1)), 10).is_err());
    assert!(get_file_history(&root, "src/new.txt", Some((3, 2)), 10).is_err());
    // git itself refuses a range past the end of the file.
    assert!(get_file_history(&root, "src/new.txt", Some((40, 50)), 10).is_err());
}

#[test]
fn parse_carries_the_path_over_records_without_names() {
    let text = "\x1eaaa\x1fa\x1fmerge\x1fDev\x1fd@x\x1f10\x1fp1 p2\n\
                \x1ebbb\x1fb\x1fedit\x1fDev\x1fd@x\x1f9\x1fp0\n\nsrc/old.txt\n\
                \x1enot-a-header\n";
    let entries = parse_file_history(text, "src/new.txt");
    assert_eq!(
        summaries(&entries),
        vec![("merge", "src/new.txt"), ("edit", "src/old.txt")]
    );
    assert_eq!(entries[0].commit.parents, vec!["p1", "p2"]);
    assert_eq!(entries[1].commit.timestamp, 9);
}

#[test]
fn file_context_rejects_non_file_or_root_paths() {
    assert!(file_context(Path::new("/")).is_err());
    assert!(file_context(Path::new("")).is_err());
}
