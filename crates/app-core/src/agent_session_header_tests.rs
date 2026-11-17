//! Tests for `agent_session_header`: UUID checks, prompt extraction and the bounded head read.

use super::*;
use serde_json::json;

const ID: &str = "16fd2706-8baf-433b-82eb-8c7fada847da";

fn lines(records: &[Value]) -> String {
    records
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn is_uuid_requires_the_exact_hex_and_dash_layout() {
    assert!(is_uuid(ID));
    assert!(!is_uuid("16fd2706"));
    assert!(!is_uuid("16fd2706x8baf-433b-82eb-8c7fada847da"));
    assert!(!is_uuid("16fd2706-8baf-433b-82eb-8c7fada847dz"));
}

#[test]
fn blank_or_non_text_content_gives_no_title() {
    let text = lines(&[
        json!({ "type": "user", "message": { "content": "   \n  " } }),
        json!({ "type": "user", "message": { "content": [{ "type": "image" }] } }),
        json!({ "type": "user", "message": { "content": 7 } }),
        json!({ "type": "assistant", "message": { "content": "assistant reply" } }),
    ]);
    let header = parse_text(&text, SessionAgent::Claude);
    assert_eq!(header.title, None);
    assert_eq!(header.cwd, None);
}

#[test]
fn claude_keeps_the_first_cwd_and_title() {
    let text = lines(&[
        json!({ "type": "user", "cwd": "/first", "message": { "content": "First prompt" } }),
        json!({ "type": "user", "cwd": "/second", "message": { "content": "Second prompt" } }),
    ]);
    let header = parse_text(&text, SessionAgent::Claude);
    assert_eq!(header.cwd.as_deref(), Some("/first"));
    assert_eq!(header.title.as_deref(), Some("First prompt"));
    assert_eq!(header.session_id, None);
}

#[test]
fn codex_reads_on_until_the_session_id_is_known() {
    let text = lines(&[
        json!({ "type": "response_item", "payload": { "id": "msg_1", "cwd": "/repo", "type": "message", "role": "assistant", "content": "hi" } }),
        json!({ "type": "response_item", "payload": { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "Ship it" }] } }),
        json!({ "type": "session_meta", "payload": { "id": ID, "cwd": "/ignored" } }),
    ]);
    let header = parse_text(&text, SessionAgent::Codex);
    assert_eq!(header.cwd.as_deref(), Some("/repo"));
    assert_eq!(header.title.as_deref(), Some("Ship it"));
    assert_eq!(header.session_id.as_deref(), Some(ID));
}

#[test]
fn an_undecodable_line_ends_the_head() {
    let mut bytes = b"\xff\xfe broken\n".to_vec();
    bytes.extend_from_slice(
        json!({ "type": "user", "cwd": "/late", "message": { "content": "Late" } })
            .to_string()
            .as_bytes(),
    );
    assert_eq!(
        parse_lines(&bytes[..], SessionAgent::Claude),
        SessionHeader::default()
    );
}

#[test]
fn read_header_reads_a_file_and_tolerates_a_missing_one() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("session.jsonl");
    std::fs::write(
        &path,
        lines(&[json!({ "type": "user", "cwd": "/w", "message": { "content": "Hello" } })]),
    )
    .expect("write transcript");

    let header = read_header(&path, SessionAgent::Claude);
    assert_eq!(header.title.as_deref(), Some("Hello"));
    assert_eq!(
        read_header(&dir.path().join("missing.jsonl"), SessionAgent::Claude),
        SessionHeader::default()
    );
}

#[test]
fn claude_keeps_reading_for_a_cwd_after_the_title() {
    let text = lines(&[
        json!({ "type": "user", "message": { "content": "Opening prompt" } }),
        json!({ "type": "user", "cwd": "/later", "message": { "content": "Follow-up" } }),
    ]);
    let header = parse_text(&text, SessionAgent::Claude);
    assert_eq!(header.title.as_deref(), Some("Opening prompt"));
    assert_eq!(header.cwd.as_deref(), Some("/later"));
}
