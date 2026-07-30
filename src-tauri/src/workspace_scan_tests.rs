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
fn skips_ignored_and_dot_directories() {
    let (_d, root) = tree();
    touch(&root.join("keep.bat"));
    touch(&root.join("node_modules").join("bad.bat"));
    touch(&root.join(".git").join("hook.sh"));
    touch(&root.join("dist").join("out.bat"));
    touch(&root.join("Node_Modules").join("case.bat"));

    let ids: Vec<_> = scan_dir(&root).into_iter().map(|s| s.id).collect();
    assert_eq!(ids, vec!["keep.bat"]);
}

#[test]
fn stops_descending_past_the_depth_limit() {
    let (_d, root) = tree();
    touch(&root.join("a").join("b").join("c").join("deep.bat"));
    touch(&root.join("a").join("b").join("c").join("d").join("too-deep.bat"));

    let ids: Vec<_> = scan_dir(&root).into_iter().map(|s| s.id).collect();
    assert_eq!(ids, vec!["a/b/c/deep.bat"]);
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
fn the_entry_scan_still_skips_ignored_and_dot_directories() {
    let (_d, root) = tree();
    touch(&root.join("keep.txt"));
    touch(&root.join("node_modules").join("bad.txt"));
    touch(&root.join(".git").join("hook.sh"));

    let ids: Vec<_> = scan_entries(&root).into_iter().map(|e| e.id).collect();
    assert_eq!(ids, vec!["keep.txt"]);
}

#[test]
fn the_entry_scan_respects_the_depth_limit() {
    let (_d, root) = tree();
    touch(&root.join("a").join("b").join("c").join("deep.txt"));
    touch(&root.join("a").join("b").join("c").join("d").join("too-deep.txt"));

    let ids: Vec<_> = scan_entries(&root).into_iter().map(|e| e.id).collect();
    // `a/b/c/d` is itself at the limit, so it is listed; nothing inside it is.
    assert_eq!(
        ids,
        vec!["a", "a/b", "a/b/c", "a/b/c/d", "a/b/c/deep.txt"]
    );
}

#[test]
fn the_entry_scan_is_bounded() {
    let (_d, root) = tree();
    for i in 0..MAX_ENTRIES + 25 {
        touch(&root.join(format!("f{i:05}.txt")));
    }
    assert_eq!(scan_entries(&root).len(), MAX_ENTRIES);
}

/// `scan_dir` is now a filter over `scan_entries`; the two must agree about the runnables.
#[test]
fn scan_dir_returns_exactly_the_runnable_entries() {
    let (_d, root) = tree();
    touch(&root.join("keep.bat"));
    touch(&root.join("tools").join("go.sh"));
    touch(&root.join("notes.txt"));
    fs::create_dir_all(root.join("empty")).unwrap();

    let ids: Vec<_> = scan_dir(&root).into_iter().map(|s| s.id).collect();
    assert_eq!(ids, vec!["keep.bat", "tools/go.sh"]);
}

// ── Serialization contract ───────────────────────────────────────────────────

/// The renderer reads `editable` and `kind` off these records (see ScriptViewer.tsx).
#[test]
fn scripts_serialize_with_the_field_names_the_renderer_reads() {
    let script = WorkspaceScript {
        id: "sub/x.bat".to_string(),
        name: "x.bat".to_string(),
        path: "C:/p/sub/x.bat".to_string(),
        kind: "bat".to_string(),
        shell: Some("cmd".to_string()),
        editable: Some(true),
        viewable: Some(true),
    };
    let value = serde_json::to_value(&script).unwrap();
    for key in ["id", "name", "path", "kind", "shell", "editable", "viewable"] {
        assert!(value.get(key).is_some(), "{key} must be serialized");
    }
}

/// The renderer switches on `isDir` and `kind` to build the tree and apply the type filter.
#[test]
fn entries_serialize_with_the_field_names_the_renderer_reads() {
    let entry = WorkspaceEntry {
        id: "sub".to_string(),
        name: "sub".to_string(),
        path: "C:/p/sub".to_string(),
        is_dir: true,
        kind: "dir".to_string(),
        shell: None,
        editable: None,
        viewable: None,
    };
    let value = serde_json::to_value(&entry).unwrap();
    for key in ["id", "name", "path", "isDir", "kind"] {
        assert!(value.get(key).is_some(), "{key} must be serialized");
    }
    assert_eq!(value["isDir"], serde_json::json!(true));
}

/// The viewer decides whether to load a file's contents from `viewable`, so the scan has to set it on
/// every file — and must keep refusing the kinds the viewer will not open.
#[test]
fn entries_flag_which_files_the_viewer_will_open() {
    let dir = tempfile::Builder::new()
        .prefix("omniterm-viewable")
        .tempdir()
        .expect("temp dir");
    let root = dir.path();
    for name in ["notes.txt", "deploy.bat", "host.rdp", "payload.exe", "id.pem", "Dockerfile"] {
        std::fs::File::create(root.join(name)).unwrap();
    }
    std::fs::create_dir(root.join("sub")).unwrap();

    let by_name: std::collections::HashMap<_, _> = scan_entries(root)
        .into_iter()
        .map(|e| (e.name.clone(), e))
        .collect();

    // Text of any kind opens, including the extensionless and the non-editable.
    for name in ["notes.txt", "deploy.bat", "host.rdp", "Dockerfile"] {
        assert_eq!(by_name[name].viewable, Some(true), "{name} should be viewable");
    }
    // An executable and key material do not.
    for name in ["payload.exe", "id.pem"] {
        assert_eq!(by_name[name].viewable, Some(false), "{name} must not be viewable");
    }
    // A directory has no contents to view — absent, not `false`.
    assert_eq!(by_name["sub"].viewable, None);
}

/// The scan's `viewable` flag must stay in step with what `read_script` will actually allow, or the
/// panel would offer to open a file the backend then refuses.
#[test]
fn scan_entries_excluding_marks_user_excluded_extensions_unviewable() {
    let (_d, root) = tree();
    touch(&root.join("notes.txt"));
    touch(&root.join("deploy.bat"));

    let excluded = vec!["txt".to_string()];
    let entries = scan_entries_excluding(&root, &excluded);
    let by_name: std::collections::HashMap<_, _> =
        entries.into_iter().map(|e| (e.name.clone(), e)).collect();
    assert_eq!(by_name["notes.txt"].viewable, Some(false));
    assert_eq!(by_name["deploy.bat"].viewable, Some(true), "unaffected extensions stay viewable");
}
