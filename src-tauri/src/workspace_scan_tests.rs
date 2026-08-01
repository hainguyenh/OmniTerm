//! Scan + classification tests for `workspace_scan`.

use super::*;
use std::fs::File;
use std::io::Write as _;
use std::path::PathBuf;

fn tree() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::Builder::new()
        .prefix("omniterm-workspace")
        .tempdir()
        .expect("temp dir");
    let root = fs::canonicalize(dir.path()).expect("canonical root");
    (dir, root)
}

fn touch(path: &Path) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    File::create(path).unwrap().write_all(b"x").unwrap();
}

// ── Classification ───────────────────────────────────────────────────────────

/// `.cmd` must classify as kind `bat`. The renderer and the run dispatcher both switch on `kind`, so
/// emitting the raw extension sent `.cmd` files down an unhandled branch.
#[test]
fn cmd_files_classify_as_bat() {
    assert_eq!(classify("cmd"), Some(("bat", Some("cmd"), true)));
    assert_eq!(classify("bat"), Some(("bat", Some("cmd"), true)));
}

#[test]
fn each_known_extension_maps_to_its_shell_and_editability() {
    assert_eq!(classify("ps1"), Some(("ps1", Some("powershell"), true)));
    assert_eq!(classify("sh"), Some(("sh", Some("wsl"), true)));
    // .rdp has no shell and is launch-only.
    assert_eq!(classify("rdp"), Some(("rdp", None, false)));
}

#[test]
fn classification_is_case_insensitive_and_rejects_everything_else() {
    assert_eq!(classify("PS1"), Some(("ps1", Some("powershell"), true)));
    for ext in ["exe", "dll", "txt", "js", "", "ps"] {
        assert_eq!(classify(ext), None, "{ext} should not be scanned");
    }
}

// ── Scanning ─────────────────────────────────────────────────────────────────

#[test]
fn finds_scripts_and_skips_other_files() {
    let (_d, root) = tree();
    touch(&root.join("deploy.bat"));
    touch(&root.join("run.ps1"));
    touch(&root.join("notes.txt"));
    touch(&root.join("app.exe"));

    let ids: Vec<_> = scan_dir(&root).into_iter().map(|s| s.id).collect();
    assert_eq!(ids, vec!["deploy.bat", "run.ps1"]);
}

/// Ids must be the POSIX-relative path, not a fresh UUID: the renderer keys its list on them, so
/// random ids make every rescan look like a completely different set of scripts.
#[test]
fn ids_are_stable_relative_posix_paths() {
    let (_d, root) = tree();
    touch(&root.join("tools").join("sub").join("go.sh"));

    let first = scan_dir(&root);
    let second = scan_dir(&root);
    assert_eq!(first[0].id, "tools/sub/go.sh");
    assert_eq!(first, second, "a rescan must produce identical records");
}

#[test]
fn results_are_sorted_by_id() {
    let (_d, root) = tree();
    for name in ["z.bat", "a.bat", "m.ps1"] {
        touch(&root.join(name));
    }
    let ids: Vec<_> = scan_dir(&root).into_iter().map(|s| s.id).collect();
    assert_eq!(ids, vec!["a.bat", "m.ps1", "z.bat"]);
}

#[test]
fn skips_ignored_directories_but_reports_hidden_files() {
    let (_d, root) = tree();
    touch(&root.join("keep.bat"));
    touch(&root.join("node_modules").join("bad.bat"));
    touch(&root.join(".git").join("hook.sh"));
    touch(&root.join("dist").join("out.bat"));
    touch(&root.join("Node_Modules").join("case.bat"));
    // Hidden *files* are real project files (`All files` shows them); only the ignored noise dirs
    // (which includes `.git`) are skipped.
    touch(&root.join(".env"));
    touch(&root.join("scripts").join(".deploy.sh"));

    let ids: Vec<_> = scan_dir(&root).into_iter().map(|s| s.id).collect();
    assert_eq!(ids, vec!["keep.bat", "scripts/.deploy.sh"]);
}

/// The old depth cap silently hid anything deeper than three folders. There is no depth limit now —
/// the tree is paged instead, which bounds cost without ever hiding files.
#[test]
fn scans_past_the_old_depth_limit() {
    let (_d, root) = tree();
    touch(&root.join("a").join("b").join("c").join("d").join("deep.bat"));
    touch(&root.join("a").join("b").join("c").join("deep.sh"));

    let ids: Vec<_> = scan_dir(&root).into_iter().map(|s| s.id).collect();
    assert_eq!(ids, vec!["a/b/c/d/deep.bat", "a/b/c/deep.sh"]);
}

#[test]
fn bounds_the_number_of_scripts_returned() {
    let (_d, root) = tree();
    for i in 0..MAX_SCRIPTS + 25 {
        touch(&root.join(format!("s{i:04}.bat")));
    }
    assert_eq!(scan_dir(&root).len(), MAX_SCRIPTS);
}

#[test]
fn an_empty_or_missing_directory_scans_to_nothing() {
    let (_d, root) = tree();
    assert!(scan_dir(&root).is_empty());
    assert!(scan_dir(&root.join("does-not-exist")).is_empty());
}

#[test]
fn scanned_records_carry_absolute_paths_and_editability() {
    let (_d, root) = tree();
    touch(&root.join("host.rdp"));
    touch(&root.join("deploy.bat"));

    let scripts = scan_dir(&root);
    let rdp = scripts.iter().find(|s| s.kind == "rdp").unwrap();
    let bat = scripts.iter().find(|s| s.kind == "bat").unwrap();
    assert_eq!(rdp.editable, Some(false));
    assert_eq!(rdp.shell, None);
    assert_eq!(bat.editable, Some(true));
    assert_eq!(bat.shell.as_deref(), Some("cmd"));
    assert!(Path::new(&bat.path).is_absolute());
    assert_eq!(bat.name, "deploy.bat");
}

// ── Full entry scan ──────────────────────────────────────────────────────────

/// The panel renders the whole folder tree, so a directory with no scripts in it must still be
/// reported — `scan_dir` synthesized folders from script paths and could never show one.
#[test]
fn entries_include_directories_that_hold_no_scripts() {
    let (_d, root) = tree();
    fs::create_dir_all(root.join("empty")).unwrap();
    touch(&root.join("tools").join("go.sh"));

    let entries = scan_entries(&root);
    let dirs: Vec<_> = entries
        .iter()
        .filter(|e| e.is_dir)
        .map(|e| e.id.as_str())
        .collect();
    assert_eq!(dirs, vec!["empty", "tools"]);
    assert!(entries.iter().all(|e| !e.is_dir || e.kind == "dir"));
}

#[test]
fn non_script_files_are_reported_with_their_extension_as_kind() {
    let (_d, root) = tree();
    touch(&root.join("notes.TXT"));
    touch(&root.join("README"));
    touch(&root.join("deploy.bat"));

    let entries = scan_entries(&root);
    let by_id = |id: &str| entries.iter().find(|e| e.id == id).unwrap();
    assert_eq!(by_id("notes.TXT").kind, "txt", "extension is lowercased");
    assert_eq!(by_id("README").kind, "file", "no extension");
    assert_eq!(by_id("deploy.bat").kind, "bat", "scripts keep their kind");
    // Only runnables carry editability; a plain file must not claim to be one.
    assert_eq!(by_id("notes.TXT").editable, None);
    assert_eq!(by_id("deploy.bat").editable, Some(true));
}

#[test]
fn the_entry_scan_reports_hidden_entries_and_deep_folders() {
    let (_d, root) = tree();
    touch(&root.join("keep.txt"));
    touch(&root.join("node_modules").join("bad.txt"));
    touch(&root.join(".git").join("hook.sh"));
    touch(&root.join(".env"));
    touch(&root.join(".vscode").join("settings.json"));
    touch(&root.join("a").join("b").join("c").join("d").join("deep.txt"));

    let ids: Vec<_> = scan_entries(&root).into_iter().map(|e| e.id).collect();
    assert_eq!(
        ids,
        vec![
            ".env",
            ".vscode",
            ".vscode/settings.json",
            "a",
            "a/b",
            "a/b/c",
            "a/b/c/d",
            "a/b/c/d/deep.txt",
            "keep.txt",
        ]
    );
}

// ── Folder skeleton ──────────────────────────────────────────────────────────

/// The panel shows every folder before any file, so `scan_folders` has to report the whole
/// skeleton — nested, hidden, and ignored directories included in exactly the way the full walk
/// would report them.
#[test]
fn the_folder_skeleton_reports_every_directory() {
    let (_d, root) = tree();
    touch(&root.join("tools").join("go.sh"));
    touch(&root.join("a").join("b").join("deep.txt"));
    touch(&root.join(".vscode").join("settings.json"));
    touch(&root.join("node_modules").join("bad.txt"));
    touch(&root.join("keep.txt"));

    let ids: Vec<_> = scan_folders(&root).into_iter().map(|e| e.id).collect();
    assert_eq!(ids, vec![".vscode", "a", "a/b", "tools"]);
    assert!(scan_folders(&root).iter().all(|e| e.is_dir && e.kind == "dir"));
}

// ── Per-folder paging ────────────────────────────────────────────────────────

/// The tree's "Show more" lives on one folder at a time, so the page lists that folder's direct
/// files only — subdirectories belong to the skeleton and are never descended into.
#[test]
fn folder_pages_cover_that_folders_files_only() {
    let (_d, root) = tree();
    touch(&root.join("b.txt"));
    touch(&root.join("a.txt"));
    touch(&root.join("sub").join("nested.txt"));
    fs::create_dir_all(root.join("empty")).unwrap();

    let page = scan_folder_files_excluding(&root, "", &[], 0, DEFAULT_PAGE_SIZE).unwrap();
    assert_eq!(
        page.entries.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
        vec!["a.txt", "b.txt"]
    );
    assert_eq!(page.total, 2);
    assert!(!page.has_more);
}

#[test]
fn folder_pages_are_sorted_and_bounded() {
    let (_d, root) = tree();
    fs::create_dir_all(root.join("src")).unwrap();
    for i in 0..DEFAULT_PAGE_SIZE + 25 {
        touch(&root.join("src").join(format!("f{i:05}.txt")));
    }

    let first = scan_folder_files_excluding(&root, "src", &[], 0, DEFAULT_PAGE_SIZE).unwrap();
    assert_eq!(first.entries.len(), DEFAULT_PAGE_SIZE);
    assert_eq!(first.total, DEFAULT_PAGE_SIZE + 25);
    assert!(first.has_more);
    // Sorted by id — parents first, and a stable walk means the same offset names the same files.
    assert!(first.entries.windows(2).all(|w| w[0].id < w[1].id));

    let second = scan_folder_files_excluding(&root, "src", &[], DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE)
        .unwrap();
    assert_eq!(second.entries.len(), 25);
    assert!(!second.has_more);

    let all: Vec<_> = first.entries.iter().chain(&second.entries).map(|e| e.id.as_str()).collect();
    assert_eq!(all.len(), DEFAULT_PAGE_SIZE + 25);
    assert_eq!(scan_folder_files_excluding(&root, "src", &[], 0, DEFAULT_PAGE_SIZE).unwrap(), first);
}

/// A folder's page must agree with the full walk about every file it lists — the same kinds, shells
/// and `viewable` flags — and must carry the user's excluded extensions too.
#[test]
fn folder_pages_agree_with_the_full_walk() {
    let (_d, root) = tree();
    touch(&root.join("scripts").join("deploy.bat"));
    touch(&root.join("scripts").join("notes.txt"));
    touch(&root.join("scripts").join("payload.exe"));
    touch(&root.join("scripts").join("sub").join("deep.ps1"));

    // The page lists a folder's *direct* files only (subdirectories belong to the skeleton), so the
    // walk's comparison set is the direct children of `scripts/` too — not `scripts/sub/deep.ps1`.
    let full: Vec<_> = scan_entries_excluding(&root, &[])
        .into_iter()
        .filter(|e| e.id.starts_with("scripts/") && !e.is_dir && !e.id["scripts/".len()..].contains('/'))
        .collect();
    let page = scan_folder_files_excluding(&root, "scripts", &[], 0, DEFAULT_PAGE_SIZE).unwrap();
    assert_eq!(page.entries, full, "the folder page must match the full walk's entries");
    assert_eq!(page.entries.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), vec![
        "scripts/deploy.bat",
        "scripts/notes.txt",
        "scripts/payload.exe",
    ]);

    let excluded = vec!["txt".to_string()];
    let page = scan_folder_files_excluding(&root, "scripts", &excluded, 0, DEFAULT_PAGE_SIZE).unwrap();
    let by_id = |id: &str| page.entries.iter().find(|e| e.id == id).unwrap();
    assert_eq!(by_id("scripts/notes.txt").viewable, Some(false));
    assert_eq!(by_id("scripts/deploy.bat").viewable, Some(true));
}

/// A hostile folder path must not escape the workspace, and a missing one is a clean error.
#[test]
fn folder_pages_reject_paths_outside_the_workspace() {
    let (_d, root) = tree();
    touch(&root.join("keep.txt"));
    for bad in ["..", "../outside", "C:\\Windows", "/etc"] {
        assert!(scan_folder_files_excluding(&root, bad, &[], 0, DEFAULT_PAGE_SIZE).is_err(), "{bad}");
    }
    assert!(scan_folder_files_excluding(&root, "does-not-exist", &[], 0, DEFAULT_PAGE_SIZE).is_err());
}
