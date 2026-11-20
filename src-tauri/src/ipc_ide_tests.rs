//! The workbench commands OmniTerm itself answers (`src/ide`), driven through Tauri's IPC layer with
//! the real local handler list and managed state, the way the webview sends them.
//!
//! Every other workbench command is answered by the embedded `ide_app` backend (`idea_host.rs`) and is
//! covered by the `crates/ide-*` tests; these fixtures only build OmniTerm's own handler.

use super::IpcApp;
use serde_json::json;
use std::fs;

/// Names of the managed state types the commands name in `State<'_, T>`.
fn state_types_of_ide_commands() -> Vec<String> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/ide");
    let mut found = Vec::new();
    for entry in fs::read_dir(dir).expect("ide sources") {
        let path = entry.expect("entry").path();
        let is_source = path.extension().is_some_and(|ext| ext == "rs");
        let is_test = path
            .file_name()
            .is_some_and(|name| name.to_string_lossy().contains("_tests"));
        if !is_source || is_test {
            continue;
        }
        let text = fs::read_to_string(&path).expect("source");
        for part in text.split("State<'_, ").skip(1) {
            if let Some(name) = part.split('>').next() {
                found.push(name.trim().to_string());
            }
        }
    }
    found.sort();
    found.dedup();
    found
}

#[test]
fn every_state_an_ide_command_reads_is_registered_with_the_app() {
    let registered = include_str!("app_state.rs");
    let used = state_types_of_ide_commands();
    // Guards the scan itself: it must see the states the commands really read.
    assert!(
        used.iter().any(|name| name == "Requests"),
        "scan did not find Requests: {used:?}"
    );
    let missing: Vec<_> = used
        .into_iter()
        .filter(|name| !registered.contains(name.as_str()))
        .collect();
    assert!(
        missing.is_empty(),
        "state read by commands but not managed in app_state.rs: {missing:?}"
    );
}

#[test]
fn ide_set_project_answers_through_the_ipc_layer() {
    let fixture = IpcApp::new();
    let project = tempfile::tempdir().expect("project dir");
    let root = project.path().to_string_lossy().into_owned();
    let workspace = fixture.ok("add_workspace", json!({ "path": root }));

    // The workspace is found and the call reaches the backend lookup; the mock app has no backend.
    let error = fixture.error("ide_set_project", json!({ "workspaceId": workspace["id"] }));
    assert!(
        error.to_string().contains("the IDE backend is not running"),
        "ide_set_project answered: {error}"
    );
}
