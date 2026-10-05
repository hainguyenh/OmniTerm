//! End-to-end IPC contract tests for temporary notes.

use super::IpcApp;
use serde_json::json;

#[test]
fn ipc_temp_note_lifecycle_and_validation() {
    let fixture = IpcApp::new();

    let initial = fixture.ok("list_temp_notes", json!({}));
    assert_eq!(initial.as_array().expect("array").len(), 0);

    let written = fixture.ok(
        "write_temp_note",
        json!({ "id": "note-1", "content": "Title\nContent line" }),
    );
    assert_eq!(written["id"], "note-1");
    assert_eq!(written["title"], "Title");

    let read = fixture.ok("read_temp_note", json!({ "id": "note-1" }));
    assert_eq!(read, "Title\nContent line");

    let list = fixture.ok("list_temp_notes", json!({}));
    assert_eq!(list.as_array().expect("array").len(), 1);

    // save_temp_note_as validation error through IPC
    fixture.error(
        "save_temp_note_as",
        json!({ "id": "../invalid-id", "suggestedName": "test.txt" }),
    );

    let deleted = fixture.ok("delete_temp_note", json!({ "id": "note-1" }));
    assert_eq!(deleted, true);

    fixture.error("read_temp_note", json!({ "id": "note-1" }));
}
