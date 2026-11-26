use super::*;

fn dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("create temp dir")
}

#[test]
fn move_attachments_carries_files_into_the_session_folder_without_overwriting() {
    let root = dir();
    let from = root.path().join("pane-1");
    let to = root.path().join("session-abc");
    fs::create_dir_all(&from).expect("create pane folder");
    fs::create_dir_all(&to).expect("create session folder");
    fs::write(from.join("shot.png"), b"new").expect("write moved file");
    fs::write(to.join("shot.png"), b"old").expect("write existing file");

    let moved = move_attachments(&from, &to).expect("move attachments");

    assert_eq!(moved.len(), 1);
    assert_eq!(moved[0].from, from.join("shot.png").to_string_lossy());
    assert_eq!(moved[0].to, to.join("shot-1.png").to_string_lossy());
    assert_eq!(
        fs::read(to.join("shot.png")).expect("existing file"),
        b"old"
    );
    assert_eq!(fs::read(to.join("shot-1.png")).expect("moved file"), b"new");
    assert!(!from.exists(), "the emptied temporary folder is removed");
}

#[test]
fn move_attachments_is_a_no_op_for_a_missing_or_identical_folder() {
    let root = dir();
    let to = root.path().join("session");
    assert!(move_attachments(&root.path().join("none"), &to)
        .expect("missing")
        .is_empty());
    assert!(move_attachments(&to, &to).expect("same").is_empty());
}
