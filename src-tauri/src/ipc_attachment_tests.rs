//! End-to-end IPC contract tests for the attachment folder commands, including the raw-body upload.

use super::IpcApp;
use serde_json::{json, Value};
use std::path::Path;
use tauri::http::{HeaderMap, HeaderValue};
use tauri::ipc::InvokeBody;

const SESSION: &str = "ipc-attach-session";

fn upload(
    fixture: &IpcApp,
    bytes: &[u8],
    headers: &[(&'static str, &str)],
) -> Result<Value, Value> {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        map.insert(*name, HeaderValue::from_str(value).expect("header value"));
    }
    fixture.invoke_with("save_attachment", InvokeBody::Raw(bytes.to_vec()), map)
}

fn file_name(path: &Value) -> String {
    Path::new(path.as_str().expect("path string"))
        .file_name()
        .and_then(|name| name.to_str())
        .expect("file name")
        .to_string()
}

#[test]
fn ipc_saves_pasted_images_and_raw_uploads_into_the_session_folder() {
    let fixture = IpcApp::new();
    // The attachments live under the local data dir, which the fixture does not reset.
    fixture.ok("clear_attachments", json!({ "sessionId": SESSION }));

    let empty = fixture.error(
        "save_temp_image",
        json!({ "bytes": [], "sessionId": SESSION }),
    );
    assert_eq!(empty, "Clipboard image payload is empty.");

    let pasted = fixture.ok(
        "save_temp_image",
        json!({ "bytes": [137, 80, 78, 71], "sessionId": SESSION }),
    );
    let pasted_path = Path::new(pasted.as_str().expect("pasted path"));
    assert_eq!(
        std::fs::read(pasted_path).expect("pasted bytes"),
        [137, 80, 78, 71]
    );
    assert_eq!(
        pasted_path
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str()),
        Some(SESSION)
    );

    // The name hint is percent-encoded by the renderer; the session id scopes the folder.
    let saved = upload(
        &fixture,
        b"hello",
        &[
            ("x-omniterm-attachment-name", "notes%20v1.txt"),
            ("x-omniterm-session-id", SESSION),
        ],
    )
    .expect("raw upload accepted");
    assert_eq!(saved["size"], 5);
    assert!(file_name(&saved["path"]).ends_with(".txt"));
    assert_eq!(
        std::fs::read(saved["path"].as_str().expect("saved path")).expect("saved bytes"),
        b"hello"
    );

    // No name header: the attachment still lands, under a generated name.
    let unnamed = upload(&fixture, b"xyz", &[("x-omniterm-session-id", SESSION)])
        .expect("upload without a name hint");
    assert_eq!(unnamed["size"], 3);

    // A JSON body is refused: multi-megabyte files must never travel as number arrays.
    let json_body = fixture.error("save_attachment", json!({ "bytes": [1, 2, 3] }));
    assert_eq!(json_body, "Attachment bytes must be sent as a raw body.");

    let listing = fixture.ok("list_attachments", json!({ "sessionId": SESSION }));
    let files = listing["files"].as_array().expect("file list");
    assert_eq!(files.len(), 3, "{listing}");
    assert!(listing["dir"]
        .as_str()
        .expect("listing dir")
        .ends_with(SESSION));

    assert_eq!(
        fixture.ok("import_clipboard_files", json!({ "sessionId": SESSION })),
        json!([])
    );

    let cleared = fixture.ok("clear_attachments", json!({ "sessionId": SESSION }));
    assert_eq!(cleared["removed"], 3);
    assert_eq!(cleared["failed"], 0);
    let after = fixture.ok("list_attachments", json!({ "sessionId": SESSION }));
    assert_eq!(after["files"], json!([]));
}
