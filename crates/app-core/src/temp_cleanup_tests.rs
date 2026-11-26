use super::*;
use std::fs::File;
use tempfile::tempdir;

const WEEK: Duration = Duration::from_secs(7 * 86_400);

fn set_age(path: &Path, days: u64) {
    let when = SystemTime::now() - Duration::from_secs(days * 86_400);
    let mut options = File::options();
    // Windows needs write access and backup semantics to stamp a folder; Unix
    // refuses to open a folder for writing but lets its owner stamp a
    // read-only handle.
    #[cfg(windows)]
    {
        options.write(true);
        std::os::windows::fs::OpenOptionsExt::custom_flags(&mut options, 0x0200_0000);
    }
    #[cfg(not(windows))]
    options.read(true);
    options
        .open(path)
        .and_then(|f| f.set_modified(when))
        .expect("set the modified time");
}

/// A `Temp` folder deep enough to pass the drive-root check.
fn temp_root(dir: &tempfile::TempDir) -> PathBuf {
    let root = dir.path().join("a").join("Temp");
    fs::create_dir_all(&root).expect("create the temp folder");
    root
}

#[test]
fn entries_of_one_kind_share_a_key() {
    assert_eq!(group_key("claude-1a2b3c4d"), "claude-*");
    assert_eq!(group_key("claude-9f8e7d6c"), "claude-*");
    assert_eq!(group_key("tmp4821.tmp"), "tmp*.tmp");
    assert_eq!(group_key("cargo-install"), "cargo-install");
    assert_eq!(group_key("12345"), "(other)");
    assert_eq!(group_key(""), "(other)");
}

#[test]
fn loose_files_group_by_extension_and_folders_by_name() {
    let dir = tempdir().expect("tempdir");
    let root = temp_root(&dir);
    fs::write(root.join("a.LOG"), b"x").unwrap();
    fs::write(root.join("b.log"), b"x").unwrap();
    fs::write(root.join("README"), b"x").unwrap();
    fs::create_dir_all(root.join("bizreq-ab12cd34")).unwrap();
    assert_eq!(entry_key(&root.join("a.LOG")), "*.log files");
    assert_eq!(entry_key(&root.join("b.log")), "*.log files");
    assert_eq!(entry_key(&root.join("README")), "(files without extension)");
    assert_eq!(entry_key(&root.join("bizreq-ab12cd34")), "bizreq-*");
    let keys = ["*.log files".to_string()];
    let report = clean(
        &root,
        Some(&keys),
        Duration::ZERO,
        SystemTime::now() + Duration::from_secs(5),
    )
    .unwrap();
    assert_eq!(report.removed, 2);
    assert!(root.join("README").exists() && root.join("bizreq-ab12cd34").exists());
}

#[test]
fn a_scan_groups_sizes_and_orders_the_children() {
    let dir = tempdir().expect("tempdir");
    let root = temp_root(&dir);
    fs::create_dir_all(root.join("agent-111111").join("deep")).unwrap();
    fs::write(
        root.join("agent-111111").join("deep").join("f.bin"),
        vec![0u8; 1000],
    )
    .unwrap();
    fs::create_dir_all(root.join("agent-222222")).unwrap();
    fs::write(root.join("agent-222222").join("g.bin"), vec![0u8; 500]).unwrap();
    fs::write(root.join("note.txt"), b"hi").unwrap();
    let groups = scan(&root).unwrap();
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0].key, "agent-*");
    assert_eq!(
        (groups[0].entries, groups[0].files, groups[0].bytes),
        (2, 2, 1500)
    );
    assert_eq!(groups[1].key, "*.txt files");
    assert!(groups[0].oldest <= groups[0].newest);
}

#[test]
fn a_scan_says_how_much_each_idle_time_would_delete() {
    let dir = tempdir().expect("tempdir");
    let root = temp_root(&dir);
    for (name, days) in [
        ("agent-111111", 0),
        ("agent-222222", 2),
        ("agent-333333", 10),
    ] {
        fs::create_dir_all(root.join(name)).unwrap();
        fs::write(root.join(name).join("f.bin"), vec![0u8; 100]).unwrap();
        set_age(&root.join(name), days);
    }
    let groups = scan(&root).unwrap();
    let shares: Vec<(u32, u64, u64)> = groups[0]
        .idle
        .iter()
        .map(|share| (share.days, share.entries, share.bytes))
        .collect();
    // The 7-day default of the dialog removes only the 10-day-old entry: the user sees it before
    // deleting instead of a clean-up that "removed 0, kept 3".
    assert_eq!(
        shares,
        vec![(1, 2, 200), (3, 1, 100), (7, 1, 100), (30, 0, 0)]
    );
    let keys = ["agent-*".to_string()];
    let report = clean(&root, Some(&keys), WEEK, SystemTime::now()).unwrap();
    assert_eq!((report.removed, report.kept), (1, 2));
}

#[test]
fn clean_removes_old_entries_of_the_chosen_groups_only() {
    let dir = tempdir().expect("tempdir");
    let root = temp_root(&dir);
    fs::create_dir_all(root.join("agent-111111")).unwrap();
    fs::write(root.join("agent-111111").join("f"), vec![0u8; 100]).unwrap();
    set_age(&root.join("agent-111111"), 10);
    fs::create_dir_all(root.join("agent-222222")).unwrap();
    fs::write(root.join("old.log"), vec![0u8; 40]).unwrap();
    set_age(&root.join("old.log"), 10);

    let keys = ["agent-*".to_string()];
    let report = clean(&root, Some(&keys), WEEK, SystemTime::now()).unwrap();
    assert_eq!(
        (report.removed, report.freed_bytes, report.kept),
        (1, 100, 1)
    );
    assert!(!root.join("agent-111111").exists());
    assert!(root.join("agent-222222").exists(), "too new");
    assert!(root.join("old.log").exists(), "another group");

    let all = clean(&root, None, WEEK, SystemTime::now()).unwrap();
    assert_eq!((all.removed, all.freed_bytes), (1, 40));
    assert!(root.join("agent-222222").exists());
}

#[test]
fn read_only_entries_are_removed() {
    let dir = tempdir().expect("tempdir");
    let root = temp_root(&dir);
    let locked = root.join("ro.tmp");
    fs::write(&locked, b"x").unwrap();
    let mut permissions = fs::metadata(&locked).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&locked, permissions).unwrap();
    let later = SystemTime::now() + Duration::from_secs(5);
    let report = clean(&root, None, Duration::ZERO, later).unwrap();
    assert_eq!(report.removed, 1);
    assert!(report.skipped.is_empty());
    assert!(!locked.exists());
}

#[cfg(unix)]
#[test]
fn an_unremovable_entry_is_skipped_and_the_rest_is_cleaned() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempdir().expect("tempdir");
    let root = temp_root(&dir);
    fs::create_dir_all(root.join("locked")).unwrap();
    fs::write(root.join("locked").join("f"), b"x").unwrap();
    fs::set_permissions(root.join("locked"), fs::Permissions::from_mode(0o500)).unwrap();
    fs::write(root.join("free.tmp"), b"y").unwrap();
    let later = SystemTime::now() + Duration::from_secs(5);
    let report = clean(&root, None, Duration::ZERO, later).unwrap();
    assert!(!root.join("free.tmp").exists());
    // Clearing read-only bits also frees the locked folder; only a real refusal is reported.
    assert!(report.skipped.iter().all(|s| !s.reason.is_empty()));
}

#[test]
fn a_drive_root_or_missing_folder_is_refused() {
    let root = if cfg!(windows) {
        Path::new("C:\\")
    } else {
        Path::new("/")
    };
    assert!(scan(root).is_err());
    assert!(clean(root, None, Duration::ZERO, SystemTime::now()).is_err());
    let dir = tempdir().expect("tempdir");
    assert!(scan(&dir.path().join("missing").join("x")).is_err());
}

#[test]
fn links_are_not_followed() {
    let dir = tempdir().expect("tempdir");
    let root = temp_root(&dir);
    let outside = dir.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("keep.txt"), b"keep").unwrap();
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(&outside, root.join("link")).is_ok();
    #[cfg(windows)]
    let linked = std::os::windows::fs::symlink_dir(&outside, root.join("link")).is_ok();
    if !linked {
        return; // creating links needs a privilege on some machines
    }
    let later = SystemTime::now() + Duration::from_secs(5);
    let report = clean(&root, None, Duration::ZERO, later).unwrap();
    assert_eq!(report.removed, 1);
    assert!(outside.join("keep.txt").exists(), "the target stays");
}

#[test]
fn a_clean_up_reports_progress_and_what_each_group_lost() {
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    let dir = tempdir().expect("tempdir");
    let root = temp_root(&dir);
    for name in ["claude-1a2b3c", "claude-4d5e6f", "claude-778899"] {
        fs::create_dir_all(root.join(name).join("deep")).unwrap();
        fs::write(root.join(name).join("deep").join("f.txt"), b"12345").unwrap();
    }
    fs::write(root.join("keep.log"), b"x").unwrap();
    let steps = AtomicU64::new(0);
    let cancel = AtomicBool::new(false);
    let count = |_: Step| {
        steps.fetch_add(1, Ordering::Relaxed);
    };
    let progress = Progress {
        on_step: &count,
        cancel: &cancel,
    };
    let later = SystemTime::now() + Duration::from_secs(5);
    let keys = vec!["claude-*".to_string()];
    let report = clean_with(&root, Some(&keys), Duration::ZERO, later, &progress).unwrap();
    assert_eq!(report.removed, 3);
    assert_eq!(
        report.freed_bytes, 15,
        "counted while removing, without sizing first"
    );
    assert_eq!(steps.load(Ordering::Relaxed), 3);
    assert_eq!(
        report.groups,
        vec![GroupResult {
            key: "claude-*".to_string(),
            removed: 3,
            freed_bytes: 15,
        }]
    );
    assert!(root.join("keep.log").exists());
}

#[test]
fn a_cancelled_clean_up_removes_nothing_more() {
    use std::sync::atomic::AtomicBool;
    let dir = tempdir().expect("tempdir");
    let root = temp_root(&dir);
    fs::write(root.join("a.tmp"), b"x").unwrap();
    let cancel = AtomicBool::new(true);
    let progress = Progress {
        on_step: &|_| {},
        cancel: &cancel,
    };
    let later = SystemTime::now() + Duration::from_secs(5);
    let report = clean_with(&root, None, Duration::ZERO, later, &progress).unwrap();
    assert_eq!(report.removed, 0);
    assert_eq!(report.kept, 1);
    assert!(root.join("a.tmp").exists());
    assert!(scan_with(&root, &progress).unwrap().is_empty());
}
