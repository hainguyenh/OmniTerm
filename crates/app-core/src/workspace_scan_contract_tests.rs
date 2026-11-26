//! Paging and serialization contract tests for `workspace_scan`.

use super::*;
use std::fs::File;
use std::io::Write as _;
use std::path::{Path, PathBuf};

fn tree() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::Builder::new()
        .prefix("omniterm-workspace")
        .tempdir()
        .expect("temp dir");
    let root = std::fs::canonicalize(dir.path()).expect("canonical root");
    (dir, root)
}

fn touch(path: &Path) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    File::create(path).unwrap().write_all(b"x").unwrap();
}

// ── Paging (whole-scan, kept for back-compat) ────────────────────────────────

#[test]
fn pages_the_entry_list_in_chunks() {
    let (_d, root) = tree();
    for i in 0..DEFAULT_PAGE_SIZE + 25 {
        touch(&root.join(format!("f{i:05}.txt")));
    }

    let first = scan_entries_page_excluding(&root, &[], 0, DEFAULT_PAGE_SIZE);
    assert_eq!(first.entries.len(), DEFAULT_PAGE_SIZE);
    assert_eq!(first.total, DEFAULT_PAGE_SIZE + 25);
    assert!(first.has_more);

    let second = scan_entries_page_excluding(&root, &[], DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE);
    assert_eq!(second.entries.len(), 25);
    assert_eq!(second.total, DEFAULT_PAGE_SIZE + 25);
    assert!(!second.has_more);

    // The pages partition the whole scan: nothing is lost or repeated.
    let all: Vec<_> = first
        .entries
        .iter()
        .chain(&second.entries)
        .map(|e| e.id.as_str())
        .collect();
    assert_eq!(all.len(), DEFAULT_PAGE_SIZE + 25);
    // And the same offset names the same entries on every call — the walk is sorted, so a rescan
    // returns the identical page. Without that, "Show more" would chase a moving list.
    assert_eq!(
        scan_entries_page_excluding(&root, &[], 0, DEFAULT_PAGE_SIZE),
        first
    );
}

#[test]
fn an_offset_past_the_end_pages_to_empty() {
    let (_d, root) = tree();
    touch(&root.join("notes.txt"));

    let page = scan_entries_page_excluding(&root, &[], 5, DEFAULT_PAGE_SIZE);
    assert!(page.entries.is_empty() && !page.has_more && page.total == 1);
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
    for key in [
        "id", "name", "path", "kind", "shell", "editable", "viewable",
    ] {
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
        deferred: Some(true),
    };
    let value = serde_json::to_value(&entry).unwrap();
    for key in ["id", "name", "path", "isDir", "kind", "deferred"] {
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
    for name in [
        "notes.txt",
        "deploy.bat",
        "host.rdp",
        "payload.exe",
        "id.pem",
        "Dockerfile",
    ] {
        std::fs::File::create(root.join(name)).unwrap();
    }
    std::fs::create_dir(root.join("sub")).unwrap();

    let by_name: std::collections::HashMap<_, _> = scan_entries(root)
        .into_iter()
        .map(|e| (e.name.clone(), e))
        .collect();

    // Text of any kind opens, including the extensionless and the non-editable.
    for name in ["notes.txt", "deploy.bat", "host.rdp", "Dockerfile"] {
        assert_eq!(
            by_name[name].viewable,
            Some(true),
            "{name} should be viewable"
        );
    }
    // An executable and key material do not.
    for name in ["payload.exe", "id.pem"] {
        assert_eq!(
            by_name[name].viewable,
            Some(false),
            "{name} must not be viewable"
        );
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
    assert_eq!(
        by_name["deploy.bat"].viewable,
        Some(true),
        "unaffected extensions stay viewable"
    );
}

// ── Entry conversion and classification fallbacks ───────────────────────────

#[test]
fn as_script_converts_script_entries_only() {
    fn make_entry(is_dir: bool, kind: &str) -> WorkspaceEntry {
        WorkspaceEntry {
            id: "s".into(),
            name: "s".into(),
            path: "s".into(),
            is_dir,
            kind: kind.into(),
            shell: None,
            editable: None,
            viewable: None,
            deferred: None,
        }
    }
    assert!(make_entry(true, "bat").as_script().is_none());
    for kind in ["txt", "json", "rs"] {
        assert!(make_entry(false, kind).as_script().is_none());
    }
    for kind in ["bat", "ps1", "sh", "rdp"] {
        let script = make_entry(false, kind).as_script().unwrap();
        assert_eq!(script.kind, kind);
    }
}

#[test]
fn scan_dir_excluding_filters_specified_extensions() {
    let tmp = tempfile::TempDir::new().unwrap();
    fs::write(tmp.path().join("build.bat"), "echo hi").unwrap();
    fs::write(tmp.path().join("setup.ps1"), "Write-Host hi").unwrap();
    let all = scan_dir_excluding(tmp.path(), &[]);
    assert!(all.iter().any(|s| s.kind == "bat"));
    let with_excluded = scan_dir_excluding(tmp.path(), &["ps1".to_string()]);
    for s in &with_excluded {
        if s.kind == "ps1" {
            assert_eq!(s.viewable, Some(false));
        }
    }
}

#[test]
fn extensionless_files_are_classified_as_kind_file() {
    let (_d, root) = tree();
    touch(&root.join("Makefile"));
    touch(&root.join("deploy.bat"));
    let entries = scan_entries_excluding(&root, &[]);
    let makefile = entries
        .iter()
        .find(|e| e.id == "Makefile")
        .expect("Makefile must appear");
    assert_eq!(makefile.kind, "file");
    assert!(makefile.shell.is_none() && makefile.editable.is_none());
    assert_eq!(makefile.viewable, Some(true));
    let scripts = scan_dir(&root);
    assert!(scripts.iter().all(|s| s.id != "Makefile"));
    assert!(scripts.iter().any(|s| s.id == "deploy.bat"));
}

#[test]
fn files_with_unknown_extensions_use_lowercase_extension_as_kind() {
    let (_d, root) = tree();
    touch(&root.join("doc.TXT"));
    touch(&root.join("config.YAML"));
    let entries = scan_entries_excluding(&root, &[]);
    assert_eq!(
        entries.iter().find(|e| e.name == "doc.TXT").unwrap().kind,
        "txt"
    );
    assert_eq!(
        entries
            .iter()
            .find(|e| e.name == "config.YAML")
            .unwrap()
            .kind,
        "yaml"
    );
}

#[test]
fn scan_entries_on_a_nonexistent_root_returns_empty_list() {
    let ghost = std::path::Path::new(if cfg!(windows) {
        r"C:\this\does\not\exist\omniterm-test"
    } else {
        "/this/does/not/exist/omniterm-test"
    });
    assert!(scan_entries_excluding(ghost, &[]).is_empty());
    assert!(scan_folders(ghost).is_empty());
}

#[cfg(unix)]
#[test]
fn the_entry_walk_skips_symlinks() {
    let (_d, root) = tree();
    touch(&root.join("real.txt"));
    std::os::unix::fs::symlink(root.join("real.txt"), root.join("link.txt")).expect("file link");
    std::os::unix::fs::symlink(root.join("missing"), root.join("dangling")).expect("dangling link");
    let ids: Vec<_> = scan_entries_excluding(&root, &[])
        .into_iter()
        .map(|entry| entry.id)
        .collect();
    assert_eq!(ids, vec!["real.txt".to_string()]);
}
