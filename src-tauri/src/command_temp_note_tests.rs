//! Temporary note commands driven through the mock runtime.

use super::*;
use crate::temp_note_commands::{
    delete_temp_note, list_temp_notes, read_temp_note, save_temp_note_as, write_temp_note,
};

#[test]
fn temp_note_commands_lifecycle_and_validation() {
    let fixture = MockApp::new();
    let app = fixture.handle();

    // Initial list is empty
    let list = block_on(list_temp_notes(app.clone())).expect("list empty");
    assert!(list.is_empty());

    // Write note
    let meta = block_on(write_temp_note(
        app.clone(),
        "my-note".to_string(),
        "Hello World\nLine 2".to_string(),
    ))
    .expect("write note");
    assert_eq!(meta.id, "my-note");
    assert_eq!(meta.title, "Hello World");

    // Read note
    let content = block_on(read_temp_note(app.clone(), "my-note".to_string())).expect("read note");
    assert_eq!(content, "Hello World\nLine 2");

    // List shows note
    let list = block_on(list_temp_notes(app.clone())).expect("list notes");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "my-note");

    // Save temp note as with invalid ID returns error before file dialog
    let err = block_on(save_temp_note_as(app.clone(), "../bad".to_string(), None))
        .expect_err("invalid id");
    assert!(err.contains("invalid") || err.contains("characters"));

    // Delete note
    let deleted = block_on(delete_temp_note(app.clone(), "my-note".to_string())).expect("delete");
    assert!(deleted);

    // Read deleted note fails
    assert!(block_on(read_temp_note(app.clone(), "my-note".to_string())).is_err());
}
