//! The workbench commands (`ui/ide`) driven through Tauri's IPC layer with the real handler list and
//! the real managed state, the way the webview sends them.
//!
//! The commands were ported by separate hands. A command whose state was never managed panics when
//! Tauri builds its arguments, and a mis-spelled argument fails to decode before the body runs, so
//! these tests invoke at least one command of every group by the names and camelCase arguments of
//! `ui/ide/bindings.ts` and treat any answer, success or typed error, as proof of the wiring.
//! Channel-streaming commands (`search_start`, `run_start`, `term_spawn`) need a webview channel and
//! are covered by their own module tests.

use super::IpcApp;
use serde_json::{json, Value};
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
    for known in ["IdeRuntime", "DocumentsState", "Requests", "ProjectState"] {
        assert!(
            used.iter().any(|name| name == known),
            "scan did not find {known}: {used:?}"
        );
    }
    let missing: Vec<_> = used
        .into_iter()
        .filter(|name| !registered.contains(name.as_str()))
        .collect();
    assert!(
        missing.is_empty(),
        "state read by commands but not managed in app_state.rs: {missing:?}"
    );
}

/// Tauri words a missing state as "not managed" and an argument that does not decode as
/// "invalid args"; any other answer, success or typed error, shows the command was reached.
fn not_a_wiring_failure(answer: &Result<Value, Value>) -> bool {
    let (Ok(value) | Err(value)) = answer;
    let text = value.to_string().to_lowercase();
    !text.contains("not managed") && !text.contains("invalid args")
}

#[test]
fn every_group_of_workbench_commands_answers_through_the_ipc_layer() {
    let fixture = IpcApp::new();
    let project = tempfile::tempdir().expect("project dir");
    let root = project.path().to_string_lossy().into_owned();
    fs::write(project.path().join("main.rs"), "fn main() {}\n").expect("source");
    let workspace = fixture.ok("add_workspace", json!({ "path": root }));
    let main = project
        .path()
        .join("main.rs")
        .to_string_lossy()
        .into_owned();

    // Files.
    assert!(fixture
        .ok("fs_read_dir", json!({ "path": root }))
        .is_array());
    assert_eq!(
        fixture.ok("fs_read_text", json!({ "path": main })),
        json!("fn main() {}\n")
    );
    // Documents and syntax.
    let doc = fixture.ok("doc_open", json!({ "path": main }));
    let id = doc["id"].clone();
    assert_eq!(doc["language"], json!("rust"));
    assert_eq!(fixture.ok("doc_snapshot", json!({ "doc": id }))["id"], id);
    assert!(fixture.ok("doc_outline", json!({ "doc": id })).is_array());
    fixture.ok("doc_close", json!({ "doc": id }));
    // Search, history, index, find.
    let query = json!({
        "pattern": "main", "isRegex": false, "caseSensitive": false, "wholeWord": false,
        "include": [], "exclude": [], "scope": { "kind": "project" }, "maxMatches": 0
    });
    fixture.ok("search_validate", json!({ "query": query }));
    assert!(fixture
        .ok("history_list", json!({ "path": main }))
        .is_array());
    assert!(not_a_wiring_failure(
        &fixture.invoke("index_status", json!({}))
    ));
    assert!(not_a_wiring_failure(
        &fixture.invoke("find_files", json!({ "query": "main", "limit": 5 }))
    ));
    // Project, settings, trust.
    fixture.ok("ide_set_project", json!({ "workspaceId": workspace["id"] }));
    assert!(fixture.ok("project_roots", json!({})).is_object());
    assert_eq!(
        fixture.ok("project_trust_status", json!({ "path": root }))["trusted"],
        json!(true),
        "a pinned folder is trusted until restricted"
    );
    // Version control: no repository here, so a typed error is the expected answer.
    assert!(not_a_wiring_failure(
        &fixture.invoke("vcs_status", json!({}))
    ));
    assert!(not_a_wiring_failure(
        &fixture.invoke("vcs_branches", json!({ "repo": null }))
    ));
    // Terminal, run, debug.
    assert!(fixture.ok("term_available_shells", json!({})).is_array());
    assert!(fixture.ok("run_list", json!({})).is_array());
    assert!(fixture.ok("debug_sessions", json!({})).is_array());
    assert!(not_a_wiring_failure(
        &fixture.invoke("run_configs", json!({}))
    ));
    // Language servers: the list answers, a document no server holds answers with a typed error,
    // and the webview cannot make a server read an arbitrary file.
    assert!(fixture.ok("lsp_servers", json!({})).is_array());
    let hover = fixture.invoke("lsp_hover", json!({ "request": 2, "doc": 987_654, "pos": { "line": 0, "col": 0 } }));
    assert!(not_a_wiring_failure(&hover));
    assert!(hover.is_err(), "no server holds an unknown document");
    let virtual_file = fixture.invoke("doc_open_virtual", json!({ "uri": "file:///etc/passwd" }));
    assert!(not_a_wiring_failure(&virtual_file));
    assert!(virtual_file.is_err(), "file: URIs are not served as virtual documents");
    // Requests and application info.
    fixture.ok("cancel_request", json!({ "id": 1 }));
    assert!(fixture.ok("app_info", json!({})).is_object());
}

fn launch(cwd: &str) -> Value {
    json!({
        "name": "App", "adapter": "debugpy", "request": "launch", "program": null,
        "args": [], "cwd": cwd, "env": {}, "extraJson": null
    })
}

#[test]
fn a_restricted_folder_refuses_to_debug_and_a_trusted_one_does_not() {
    let fixture = IpcApp::new();
    let project = tempfile::tempdir().expect("project dir");
    let root = project.path().to_string_lossy().into_owned();
    fixture.ok("add_workspace", json!({ "path": root }));

    fixture.ok(
        "project_trust_set",
        json!({ "path": root, "trusted": false, "folder": false }),
    );
    let refused = fixture.error("debug_start", json!({ "config": launch(&root) }));
    assert!(
        refused.to_string().contains("Restricted Mode"),
        "refusal: {refused}"
    );

    fixture.ok(
        "project_trust_set",
        json!({ "path": root, "trusted": true, "folder": false }),
    );
    let answer = fixture.invoke("debug_start", json!({ "config": launch(&root) }));
    let text = match &answer {
        Ok(value) | Err(value) => value.to_string(),
    };
    assert!(
        !text.contains("Restricted Mode"),
        "a trusted folder must get past the trust check: {text}"
    );
}
