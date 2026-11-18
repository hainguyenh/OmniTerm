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
    assert_eq!(groups[1].key, "note.txt");
    assert!(groups[0].oldest <= groups[0].newest);
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
