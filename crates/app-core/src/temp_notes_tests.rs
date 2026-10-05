use tempfile::tempdir;

use super::*;

#[test]
fn test_validate_note_id() {
    assert!(validate_note_id("note-123_abc").is_ok());
    assert!(validate_note_id("").is_err());
    assert!(validate_note_id("../traversal").is_err());
    assert!(validate_note_id("note/path").is_err());
    assert!(validate_note_id("note\\path").is_err());
}

#[test]
fn test_temp_notes_lifecycle() {
    let dir = tempdir().expect("temp dir");
    let temp_path = dir.path();

    let initial = list_temp_notes(temp_path).expect("list empty");
    assert!(initial.is_empty());

    let note = write_temp_note(temp_path, "note-1", "My First Note\nSecond line here")
        .expect("write note");
    assert_eq!(note.id, "note-1");
    assert_eq!(note.title, "My First Note");

    let content = read_temp_note(temp_path, "note-1").expect("read note");
    assert_eq!(content, "My First Note\nSecond line here");

    let list = list_temp_notes(temp_path).expect("list notes");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "note-1");
    assert_eq!(list[0].title, "My First Note");

    delete_temp_note(temp_path, "note-1").expect("delete note");
    assert!(read_temp_note(temp_path, "note-1").is_err());
    assert!(list_temp_notes(temp_path)
        .expect("list after delete")
        .is_empty());
}

#[test]
fn test_extract_title_fallback() {
    assert_eq!(extract_title("   \n\n  "), "Untitled Note");
    assert_eq!(extract_title("Short title"), "Short title");
    let long = "a".repeat(50);
    let extracted = extract_title(&long);
    assert_eq!(extracted.chars().count(), 41); // 40 chars + ellipsis
    assert!(extracted.ends_with('…'));
}

#[test]
fn test_temp_notes_edge_cases_and_filtering() {
    let dir = tempdir().expect("temp dir");
    let non_existent = dir.path().join("sub_temp");

    // list on non-existent dir returns empty vec
    let empty = list_temp_notes(&non_existent).expect("non existent dir list");
    assert!(empty.is_empty());

    // write creates the directory if it didn't exist
    let written = write_temp_note(&non_existent, "note-sub", "Sub Note").expect("write sub note");
    assert_eq!(written.id, "note-sub");
    assert!(non_existent.exists());

    // invalid IDs error on read, write, delete
    assert!(read_temp_note(&non_existent, "invalid/id").is_err());
    assert!(write_temp_note(&non_existent, "invalid/id", "content").is_err());
    assert!(delete_temp_note(&non_existent, "invalid/id").is_err());

    // non-existent note errors on read
    assert!(read_temp_note(&non_existent, "missing-note").is_err());

    // non-existent note delete succeeds cleanly
    assert!(delete_temp_note(&non_existent, "missing-note").is_ok());

    // list filters out subdirectories, non-txt files and invalid-id files
    std::fs::create_dir(non_existent.join("nested_folder")).expect("create folder");
    std::fs::write(non_existent.join("readme.md"), b"markdown").expect("write md");
    std::fs::write(non_existent.join("bad id.txt"), b"invalid stem").expect("write bad stem");
    std::fs::write(non_existent.join(".txt"), b"empty stem").expect("write empty stem");

    let list = list_temp_notes(&non_existent).expect("list filtered");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "note-sub");

    // multiple notes exercise sorting by mtime
    let written2 = write_temp_note(&non_existent, "note-sub2", "Sub Note 2").expect("write note 2");
    assert_eq!(written2.id, "note-sub2");
    let list_multi = list_temp_notes(&non_existent).expect("list multi");
    assert_eq!(list_multi.len(), 2);

    // write fails when temp_dir is a file
    let file_as_dir = dir.path().join("file_not_dir");
    std::fs::write(&file_as_dir, b"not a directory").expect("write file");
    assert!(write_temp_note(&file_as_dir, "note-fail", "content").is_err());
    assert!(list_temp_notes(&file_as_dir).is_err());

    // write and delete fail when note path is an existing directory
    let note_dir_path = non_existent.join("note-is-dir.txt");
    std::fs::create_dir(&note_dir_path).expect("create note dir");
    assert!(write_temp_note(&non_existent, "note-is-dir", "content").is_err());
    assert!(delete_temp_note(&non_existent, "note-is-dir").is_err());
}
