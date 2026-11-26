use super::*;
use serde_json::json;

#[test]
fn a_saved_document_loads_back_unchanged() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("agent-sessions.json");
    let document = json!({ "version": 1, "sessions": [{ "id": "claude:x" }], "pins": [] });

    save_store(&path, &document).expect("save");

    assert_eq!(load_store(&path), Some(document));
    assert!(
        !path.with_extension("json.tmp").exists(),
        "the temp file is renamed away"
    );
}

#[test]
fn saving_replaces_the_previous_document() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("nested").join("agent-sessions.json");

    save_store(&path, &json!({ "sessions": [1] })).expect("first save creates the folder");
    save_store(&path, &json!({ "sessions": [2] })).expect("second save");

    assert_eq!(load_store(&path), Some(json!({ "sessions": [2] })));
}

#[test]
fn a_missing_or_corrupt_file_loads_as_nothing() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("agent-sessions.json");
    assert_eq!(load_store(&path), None);

    fs::write(&path, "{ not json").expect("write corrupt file");
    assert_eq!(load_store(&path), None);

    fs::write(&path, "[1, 2, 3]").expect("write non-object");
    assert_eq!(load_store(&path), None);
}

#[test]
fn an_oversized_file_is_ignored_and_never_written() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("agent-sessions.json");
    let huge = "x".repeat(MAX_STORE_BYTES + 1);

    fs::write(&path, format!("{{\"blob\":\"{huge}\"}}")).expect("write oversized file");
    assert_eq!(load_store(&path), None);

    let error = save_store(&path, &json!({ "blob": huge })).expect_err("oversized save is refused");
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
}

#[test]
fn only_objects_are_saved() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("agent-sessions.json");

    let error = save_store(&path, &json!([1, 2])).expect_err("arrays are refused");
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert!(!path.exists());
}

#[test]
fn a_directory_in_place_of_the_store_loads_as_nothing() {
    let dir = tempfile::tempdir().expect("temp dir");
    assert_eq!(load_store(dir.path()), None);
}

#[test]
fn saving_reports_a_parent_that_cannot_be_created() {
    let dir = tempfile::tempdir().expect("temp dir");
    let blocker = dir.path().join("blocker");
    fs::write(&blocker, b"file").expect("write blocker");
    let error =
        save_store(&blocker.join("store.json"), &json!({ "a": 1 })).expect_err("parent is a file");
    assert_ne!(error.kind(), io::ErrorKind::InvalidInput);
}

#[test]
fn saving_reports_a_temp_file_that_cannot_be_created() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("store.json");
    fs::create_dir(dir.path().join("store.json.tmp")).expect("block temp path");
    assert!(save_store(&path, &json!({ "a": 1 })).is_err());
    assert!(!path.exists());
}

#[test]
fn a_failed_replace_removes_the_temp_file() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("store.json");
    fs::create_dir(&path).expect("directory in place of the store");
    fs::write(path.join("keep"), b"x").expect("make the directory non-empty");

    assert!(save_store(&path, &json!({ "a": 1 })).is_err());
    assert!(!dir.path().join("store.json.tmp").exists());
    assert!(path.join("keep").exists());
}
