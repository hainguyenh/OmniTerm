//! Tests for `workspace_fs`: subfolder creation, file rename/move (same folder, across folders,
//! case-only), deletion, and every refusal — escapes, bad names, kind changes and directories.

use super::*;

struct Fixture {
    _dir: tempfile::TempDir,
    root: PathBuf,
    other: PathBuf,
    outside: PathBuf,
}

fn fixture() -> Fixture {
    let dir = tempfile::Builder::new()
        .prefix("omniterm-workspace-fs")
        .tempdir()
        .expect("temp dir");
    let base = dunce::canonicalize(dir.path()).expect("canonical base");
    let root = base.join("workspace");
    let other = base.join("second");
    let outside = base.join("outside");
    for path in [root.join("sub"), other.clone(), outside.clone()] {
        fs::create_dir_all(path).expect("create fixture dir");
    }
    fs::write(root.join("notes.txt"), b"notes").expect("write notes");
    fs::write(root.join("sub/run.sh"), b"echo hi").expect("write script");
    Fixture {
        _dir: dir,
        root,
        other,
        outside,
    }
}

fn text(path: PathBuf) -> String {
    String::from_utf8(fs::read(path).expect("read fixture file")).expect("utf-8 fixture")
}

impl Fixture {
    fn root(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    fn other(&self) -> String {
        self.other.to_string_lossy().into_owned()
    }
}

#[test]
fn create_directory_makes_one_folder_and_returns_the_normalized_path() {
    let fx = fixture();
    let created = create_directory(&fx.root(), "./sub//nested").expect("create nested");
    assert_eq!(created, "sub/nested");
    assert!(fx.root.join("sub/nested").is_dir());

    assert_eq!(
        create_directory(&fx.root(), "sub/nested").expect_err("existing folder"),
        EXISTS
    );
    assert_eq!(
        create_directory(&fx.root(), "notes.txt").expect_err("existing file"),
        EXISTS
    );
    assert!(
        create_directory(&fx.root(), "missing/child").is_err(),
        "the parent must already exist"
    );
    assert!(!fx.root.join("missing").exists());
}

#[test]
fn create_directory_refuses_escapes_and_unusable_names() {
    let fx = fixture();
    for path in ["", ".", "../outside/x", "sub/../../outside/x"] {
        assert_eq!(create_directory(&fx.root(), path).expect_err(path), OUTSIDE);
    }
    let absolute = fx.outside.join("x").to_string_lossy().into_owned();
    assert_eq!(
        create_directory(&fx.root(), &absolute).expect_err("absolute"),
        OUTSIDE
    );
    assert!(!fx.outside.join("x").exists());

    for name in [
        "a:b",
        "a*b",
        "a?b",
        "a|b",
        "a<b",
        "a\"b",
        "tab\there",
        "dot.",
        "space ",
    ] {
        assert!(
            create_directory(&fx.root(), name).is_err(),
            "{name:?} should be refused"
        );
    }
    for name in ["CON", "nul.txt", "Com1", "lpt9.log"] {
        let error = create_directory(&fx.root(), name).expect_err(name);
        assert!(error.contains("reserved name"), "{name}: {error}");
    }
    assert_eq!(
        create_directory(&fx.root(), "   ").expect_err("blank"),
        "Name cannot be empty."
    );
    assert!(
        create_directory(&fx.root(), "console").is_ok(),
        "only exact device names are reserved"
    );
}

#[test]
fn move_file_renames_in_place_and_moves_between_folders() {
    let fx = fixture();
    assert_eq!(
        move_file(&fx.root(), "notes.txt", &fx.root(), "readme.md").expect("rename"),
        "readme.md"
    );
    assert!(!fx.root.join("notes.txt").exists());
    assert_eq!(text(fx.root.join("readme.md")), "notes");

    assert_eq!(
        move_file(&fx.root(), "readme.md", &fx.root(), "sub/readme.md").expect("move down"),
        "sub/readme.md"
    );
    assert_eq!(
        move_file(&fx.root(), "sub/readme.md", &fx.other(), "readme.md").expect("cross folder"),
        "readme.md"
    );
    assert!(!fx.root.join("sub/readme.md").exists());
    assert_eq!(text(fx.other.join("readme.md")), "notes");

    assert_eq!(
        move_file(&fx.other(), "readme.md", &fx.other(), "readme.md").expect("no-op"),
        "readme.md"
    );
    assert_eq!(text(fx.other.join("readme.md")), "notes");
}

#[test]
fn move_file_changes_only_letter_case_without_refusing_itself() {
    let fx = fixture();
    move_file(&fx.root(), "notes.txt", &fx.root(), "Notes.txt").expect("case-only rename");
    let names: Vec<String> = fs::read_dir(&fx.root)
        .expect("list root")
        .map(|entry| {
            entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    assert!(names.contains(&"Notes.txt".to_string()), "{names:?}");
    assert!(!names.contains(&"notes.txt".to_string()), "{names:?}");
}

#[test]
fn move_file_never_replaces_an_existing_entry() {
    let fx = fixture();
    fs::write(fx.root.join("sub/notes.txt"), b"keep me").expect("write clash");
    assert_eq!(
        move_file(&fx.root(), "notes.txt", &fx.root(), "sub/notes.txt").expect_err("clash"),
        EXISTS
    );
    assert_eq!(
        move_file(&fx.root(), "notes.txt", &fx.root(), "sub").expect_err("folder clash"),
        EXISTS
    );
    assert_eq!(text(fx.root.join("sub/notes.txt")), "keep me");
    assert_eq!(text(fx.root.join("notes.txt")), "notes");
}

#[test]
fn move_file_refuses_folders_missing_files_escapes_and_denied_kinds() {
    let fx = fixture();
    assert_eq!(
        move_file(&fx.root(), "sub", &fx.root(), "renamed").expect_err("folder"),
        "Only files can be renamed or moved."
    );
    assert_eq!(
        move_file(&fx.root(), "gone.txt", &fx.root(), "x.txt").expect_err("missing"),
        "That file no longer exists."
    );
    assert_eq!(
        move_file(&fx.root(), "notes.txt", &fx.root(), "../outside/notes.txt").expect_err("escape"),
        OUTSIDE
    );
    assert_eq!(
        move_file(&fx.root(), "../outside", &fx.root(), "x.txt").expect_err("escaping source"),
        OUTSIDE
    );
    assert!(move_file(&fx.root(), "notes.txt", &fx.root(), "bad:name.txt").is_err());

    let error = move_file(&fx.root(), "notes.txt", &fx.root(), "notes.exe").expect_err("exe");
    assert!(error.contains(".exe"), "{error}");
    assert!(fx.root.join("notes.txt").exists());

    fs::write(fx.root.join("photo.png"), b"\x89PNG").expect("write png");
    move_file(&fx.root(), "photo.png", &fx.root(), "sub/holiday.PNG")
        .expect("a file may keep its own kind");
    move_file(&fx.root(), "sub/run.sh", &fx.root(), "sub/run.ps1")
        .expect("viewable kinds may change");
}

#[test]
fn delete_file_removes_files_and_refuses_folders_and_escapes() {
    let fx = fixture();
    delete_file(&fx.root(), "sub/run.sh").expect("delete script");
    assert!(!fx.root.join("sub/run.sh").exists());
    assert_eq!(
        delete_file(&fx.root(), "sub/run.sh").expect_err("already gone"),
        "That file no longer exists."
    );
    assert_eq!(
        delete_file(&fx.root(), "sub").expect_err("folder"),
        "Only files can be deleted from the workspace tree."
    );
    assert!(fx.root.join("sub").is_dir());

    fs::write(fx.outside.join("secret.txt"), b"secret").expect("write outside");
    assert_eq!(
        delete_file(&fx.root(), "../outside/secret.txt").expect_err("escape"),
        OUTSIDE
    );
    assert_eq!(delete_file(&fx.root(), "").expect_err("root"), OUTSIDE);
    assert!(fx.outside.join("secret.txt").exists());
}

#[cfg(unix)]
#[test]
fn symlinks_are_handled_as_links_and_cannot_lead_outside() {
    use std::os::unix::fs::symlink;
    let fx = fixture();
    fs::write(fx.outside.join("target.txt"), b"target").expect("write outside file");
    symlink(fx.outside.join("target.txt"), fx.root.join("link.txt")).expect("file link");
    symlink(&fx.outside, fx.root.join("escape")).expect("dir link");

    assert_eq!(
        create_directory(&fx.root(), "escape/planted").expect_err("linked parent"),
        OUTSIDE
    );
    assert!(!fx.outside.join("planted").exists());

    move_file(&fx.root(), "link.txt", &fx.root(), "renamed.txt").expect("rename the link");
    assert!(fs::symlink_metadata(fx.root.join("renamed.txt"))
        .expect("renamed link")
        .file_type()
        .is_symlink());
    delete_file(&fx.root(), "renamed.txt").expect("delete the link");
    assert_eq!(text(fx.outside.join("target.txt")), "target");
}

#[test]
fn the_cross_drive_fallback_copies_then_removes_and_never_replaces() {
    let fx = fixture();
    copy_then_remove(&fx.root.join("notes.txt"), &fx.other.join("notes.txt")).expect("copy move");
    assert!(!fx.root.join("notes.txt").exists());
    assert_eq!(text(fx.other.join("notes.txt")), "notes");

    fs::write(fx.root.join("clash.txt"), b"mine").expect("write source");
    fs::write(fx.other.join("clash.txt"), b"theirs").expect("write clash");
    assert_eq!(
        copy_then_remove(&fx.root.join("clash.txt"), &fx.other.join("clash.txt"))
            .expect_err("clash"),
        EXISTS
    );
    assert_eq!(text(fx.root.join("clash.txt")), "mine");
    assert_eq!(text(fx.other.join("clash.txt")), "theirs");

    let error = copy_then_remove(&fx.root.join("gone.txt"), &fx.other.join("gone.txt"))
        .expect_err("missing source");
    assert!(error.starts_with("Could not move the file"), "{error}");
    assert!(!fx.other.join("gone.txt").exists());
}

#[test]
fn missing_or_formats_unexpected_io_errors() {
    let err = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
    let msg = missing_or(err, "Could not delete");
    assert!(msg.starts_with("Could not delete:"));
}
