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
