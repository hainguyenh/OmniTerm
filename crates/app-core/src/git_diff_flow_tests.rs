//! Diff retrieval against real repositories plus the edge cases of the diff, porcelain, branch and
//! stash line parsers.

use app_protocol::git::{GitDiffLineType, GitFileDiff, GitFileStatus};

use crate::git::{
    get_file_diff, get_file_diff_against_ref, parse_branch_line, parse_porcelain_v2,
    parse_stash_line, parse_unified_diff, stage_paths, strip_ansi_codes,
};
use crate::git_test_repo::TestRepo;

fn line_types(diff: &GitFileDiff) -> Vec<GitDiffLineType> {
    diff.hunks
        .iter()
        .flat_map(|hunk| hunk.lines.iter().map(|line| line.line_type))
        .collect()
}

fn contents(diff: &GitFileDiff) -> Vec<&str> {
    diff.hunks
        .iter()
        .flat_map(|hunk| hunk.lines.iter().map(|line| line.content.as_str()))
        .collect()
}

#[test]
fn diff_reports_unstaged_and_staged_modifications() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\nTWO\nthree\n");

    let unstaged = get_file_diff(&repo.root, "a.txt", false).expect("unstaged diff");
    assert_eq!(unstaged.path, "a.txt");
    assert!(!unstaged.is_binary);
    assert_eq!(unstaged.hunks.len(), 1);
    assert_eq!(contents(&unstaged), vec!["one", "two", "TWO", "three"]);
    assert_eq!(
        line_types(&unstaged),
        vec![
            GitDiffLineType::Context,
            GitDiffLineType::Deletion,
            GitDiffLineType::Addition,
            GitDiffLineType::Context,
        ]
    );
    assert!(get_file_diff(&repo.root, "a.txt", true)
        .expect("nothing staged")
        .hunks
        .is_empty());

    stage_paths(&repo.root, &["a.txt".to_string()]).expect("stage");
    let absolute = repo.root.join("a.txt").to_string_lossy().into_owned();
    let staged = get_file_diff(&repo.root, &absolute, true).expect("staged diff");
    assert_eq!(
        staged.path, "a.txt",
        "absolute paths are made repo-relative"
    );
    assert_eq!(contents(&staged), contents(&unstaged));
    assert!(get_file_diff(&repo.root, "./a.txt", false)
        .expect("clean worktree")
        .hunks
        .is_empty());
}

#[test]
fn diff_synthesizes_untracked_files_and_flags_binaries() {
    let repo = TestRepo::new();
    repo.write("notes/new.txt", "x\ny\n");
    let untracked = get_file_diff(&repo.root, "notes\\new.txt", false).expect("untracked");
    assert_eq!(untracked.path, "notes/new.txt");
    assert_eq!(untracked.hunks.len(), 1);
    assert_eq!(untracked.hunks[0].new_lines, 2);
    assert_eq!(contents(&untracked), vec!["x", "y"]);
    assert!(line_types(&untracked)
        .iter()
        .all(|t| *t == GitDiffLineType::Addition));

    std::fs::write(repo.root.join("blob.bin"), b"a\0b\0c").expect("write binary");
    let binary = get_file_diff(&repo.root, "blob.bin", false).expect("untracked binary");
    assert!(binary.is_binary);
    assert!(binary.hunks.is_empty());

    repo.git(&["add", "blob.bin"]);
    repo.git(&["commit", "-q", "-m", "add binary"]);
    std::fs::write(repo.root.join("blob.bin"), b"z\0y").expect("rewrite binary");
    let tracked_binary = get_file_diff(&repo.root, "blob.bin", false).expect("binary diff");
    assert!(tracked_binary.is_binary);

    // A missing, never-tracked path is simply an empty diff.
    let missing = get_file_diff(&repo.root, "ghost.txt", false).expect("missing path");
    assert!(missing.hunks.is_empty());
}

#[test]
fn diff_shows_deletions_and_compares_against_refs() {
    let repo = TestRepo::new();
    let first = repo.head();
    repo.commit_file("a.txt", "one\ntwo\nthree\nfour\n", "append four");

    let against = get_file_diff_against_ref(&repo.root, "a.txt", &first).expect("vs first");
    assert_eq!(contents(&against), vec!["one", "two", "three", "four"]);
    assert_eq!(
        against.hunks[0].lines[3].line_type,
        GitDiffLineType::Addition
    );
    assert_eq!(against.hunks[0].lines[3].new_lineno, Some(4));
    assert!(get_file_diff_against_ref(&repo.root, "a.txt", "HEAD")
        .expect("vs HEAD")
        .hunks
        .is_empty());
    assert!(get_file_diff_against_ref(&repo.root, "a.txt", "no-such-ref").is_err());

    std::fs::remove_file(repo.root.join("a.txt")).expect("delete");
    let deleted = get_file_diff(&repo.root, "a.txt", false).expect("deleted diff");
    assert_eq!(deleted.hunks[0].new_lines, 0);
    assert!(line_types(&deleted)
        .iter()
        .all(|t| *t == GitDiffLineType::Deletion));
}

#[test]
fn diff_falls_back_to_reading_untracked_files_when_git_cannot() {
    let repo = TestRepo::new();
    // A failing textconv driver makes `git diff --no-index` exit 128 for these files.
    repo.commit_file(".gitattributes", "*.tc diff=boom\n", "attributes");
    repo.git(&["config", "diff.boom.textconv", "no-such-textconv-xyz"]);

    repo.write("text.tc", "l1\nl2\n");
    let text = get_file_diff(&repo.root, "text.tc", false).expect("text fallback");
    assert!(!text.is_binary);
    assert_eq!(text.hunks.len(), 1);
    assert_eq!(text.hunks[0].header, "@@ -0,0 +1,2 @@");
    assert_eq!(contents(&text), vec!["l1", "l2"]);
    assert_eq!(text.hunks[0].lines[1].new_lineno, Some(2));

    std::fs::write(repo.root.join("blob.tc"), b"a\0b").expect("write binary");
    let blob = get_file_diff(&repo.root, "blob.tc", false).expect("binary fallback");
    assert!(blob.is_binary);

    std::fs::write(repo.root.join("latin.tc"), b"caf\xe9\n").expect("write latin-1");
    let latin = get_file_diff(&repo.root, "latin.tc", false).expect("non-UTF-8 fallback");
    assert!(!latin.is_binary);
    assert!(
        latin.hunks.is_empty(),
        "undecodable text has no synthesized hunk"
    );
}

#[test]
fn diff_accepts_a_file_as_the_working_directory() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    let diff = get_file_diff(&repo.root.join("a.txt"), "a.txt", false).expect("diff");
    assert_eq!(contents(&diff), vec!["one", "two", "three"]);
}

#[test]
fn diff_fails_outside_a_repository() {
    let repo = TestRepo::new();
    let missing = repo.base().join("missing");
    assert!(get_file_diff(&missing, "a.txt", false)
        .unwrap_err()
        .contains("Directory does not exist"));
    assert!(get_file_diff_against_ref(&missing, "a.txt", "HEAD").is_err());

    let plain = repo.base().join("plain");
    std::fs::create_dir(&plain).expect("plain dir");
    assert!(get_file_diff(&plain, "a.txt", false).is_err());
}

#[test]
fn unified_diff_parser_handles_headers_and_noise() {
    let text = "diff --git a/f b/f\n--- a/f\n+++ b/f\n\
                @@ -3 +3 @@ fn ctx()\n-old\n+new\n\\ No newline at end of file\n\
                @@ -10,2 +10,0 @@\n-gone 1\n-gone 2\n\
                @@ malformed\n context-free\n";
    let diff = parse_unified_diff("f", text);
    assert_eq!(diff.hunks.len(), 3);
    let first = &diff.hunks[0];
    assert_eq!(
        (
            first.old_start,
            first.old_lines,
            first.new_start,
            first.new_lines
        ),
        (3, 1, 3, 1)
    );
    assert_eq!(first.header, "@@ -3 +3 @@ fn ctx()");
    assert_eq!(first.lines.len(), 2, "the no-newline marker is not a line");
    let second = &diff.hunks[1];
    assert_eq!(
        (second.old_start, second.old_lines, second.new_lines),
        (10, 2, 0)
    );
    assert_eq!(second.lines[1].old_lineno, Some(11));
    let third = &diff.hunks[2];
    assert_eq!(
        (
            third.old_start,
            third.old_lines,
            third.new_start,
            third.new_lines
        ),
        (1, 0, 1, 0)
    );
    assert_eq!(third.lines[0].content, "context-free");

    let bogus = parse_unified_diff("g", "@@ -x,y +z @@\n+a\n");
    assert_eq!(
        (bogus.hunks[0].old_start, bogus.hunks[0].old_lines),
        (1, 1),
        "unparsable numbers fall back to 1"
    );
    assert!(parse_unified_diff("h", "").hunks.is_empty());
}

#[test]
fn strip_ansi_drops_non_color_escapes_too() {
    assert_eq!(
        strip_ansi_codes("\x1b[2Kplain\x1b[1;31mred\x1b[0m"),
        "plainred"
    );
    assert_eq!(strip_ansi_codes("no escapes"), "no escapes");
}

#[test]
fn porcelain_parser_covers_codes_and_malformed_entries() {
    let raw = b"# branch.oid (initial)\0\
# branch.head (detached)\0\
# branch.upstream \0\
# branch.ab +x -y\0\
1 A. N... 100644 100644 100644 1111 2222 added.txt\0\
1 TC N... 100644 100644 100644 1111 2222 typed.txt\0\
1 D! N... 100644 100644 100644 1111 2222 removed.txt\0\
1 ZZ N... 100644 100644 100644 1111 2222 odd.txt\0\
1 ?U N... 100644 100644 100644 1111 2222 q.txt\0\
1 M. N... too few fields\0\
1 M. N... 100644 100644 100644 1111 2222 \0\
1 \0\
2 RM N... 100644 100644 100644 1111 2222 R90 moved.txt\0\0\
2 R. N... 100644 100644 100644 1111 2222 R90 other.txt\0\r\0\
2 R\0\
u UU N... 100644 100644 100644 100644 1 2 3 both.txt\0\
u UU short\0\
? \0\
? \r\0\
! ignored.txt\0";
    let status = parse_porcelain_v2(raw, "/repo");
    assert_eq!(status.repo_root, "/repo");
    assert!(status.is_detached);
    assert_eq!(status.branch, None);
    assert_eq!(status.upstream, None);
    assert_eq!((status.ahead, status.behind), (0, 0));
    assert_eq!(status.conflict_count, 2, "every `u` record counts");

    let summary: Vec<(&str, GitFileStatus, GitFileStatus)> = status
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.staged, f.unstaged))
        .collect();
    assert_eq!(
        summary,
        vec![
            ("added.txt", GitFileStatus::Added, GitFileStatus::Unmodified),
            (
                "typed.txt",
                GitFileStatus::TypeChanged,
                GitFileStatus::Copied
            ),
            (
                "removed.txt",
                GitFileStatus::Deleted,
                GitFileStatus::Ignored
            ),
            (
                "odd.txt",
                GitFileStatus::Unmodified,
                GitFileStatus::Unmodified
            ),
            ("q.txt", GitFileStatus::Untracked, GitFileStatus::Conflicted),
            ("moved.txt", GitFileStatus::Renamed, GitFileStatus::Modified),
            (
                "other.txt",
                GitFileStatus::Renamed,
                GitFileStatus::Unmodified
            ),
            (
                "both.txt",
                GitFileStatus::Conflicted,
                GitFileStatus::Conflicted
            ),
        ]
    );
    assert_eq!(status.files[5].orig_path, None, "empty original path");
    assert_eq!(status.files[6].orig_path, None, "blank original path");
}

#[test]
fn branch_line_parser_filters_heads_and_reads_tracking() {
    assert!(parse_branch_line("").is_none());
    assert!(parse_branch_line("HEAD\t*").is_none());
    assert!(parse_branch_line("origin/HEAD").is_none());

    let ahead = parse_branch_line("topic\t \torigin/topic\t[ahead 3]\tnot-a-number\t\t")
        .expect("ahead branch");
    assert_eq!((ahead.ahead, ahead.behind, ahead.is_gone), (3, 0, false));
    assert_eq!(ahead.last_commit_timestamp, None);
    assert_eq!(ahead.last_commit_message, None);
    assert_eq!(ahead.last_commit_author, None);

    let behind = parse_branch_line("old\t\torigin/old\t[behind x, behind 2]").expect("behind");
    assert_eq!((behind.ahead, behind.behind), (0, 2));
    let gone = parse_branch_line("dead\t\torigin/dead\t[gone]").expect("gone");
    assert!(gone.is_gone);

    let remote = parse_branch_line("remotes/upstream/x").expect("remote");
    assert!(remote.is_remote);
    assert!(!remote.is_current);
    assert_eq!(remote.upstream, None);
}

#[test]
fn stash_line_parser_defaults_missing_fields() {
    let bare = parse_stash_line("stash@{3}").expect("bare entry");
    assert_eq!(bare.index, 3);
    assert_eq!(bare.message, "WIP");
    assert_eq!(bare.timestamp, None);

    let blank_time = parse_stash_line("stash@{1}\x1f \x1fOn main: x").expect("blank time");
    assert_eq!(blank_time.timestamp, None);
    assert_eq!(blank_time.message, "On main: x");

    assert!(parse_stash_line("stash@{x}\x1fnow\x1fmsg").is_none());
    assert!(parse_stash_line("stash@{1").is_none());
    assert!(parse_stash_line("").is_none());
}
