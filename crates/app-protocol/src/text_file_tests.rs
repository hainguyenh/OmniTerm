use super::*;
use serde_json::json;

#[test]
fn content_serializes_camel_case() {
    let content = TextFileContent {
        content: "a".to_string(),
        size: 4,
        mtime_ms: 7,
        line_count: 1,
        max_line_len: 1,
        eol: TextEol::Crlf,
        mixed_eol: false,
        has_bom: true,
        read_only: false,
    };
    let value = serde_json::to_value(&content).expect("serialize content");
    assert_eq!(
        value,
        json!({
            "content": "a", "size": 4, "mtimeMs": 7, "lineCount": 1, "maxLineLen": 1,
            "eol": "crlf", "mixedEol": false, "hasBom": true, "readOnly": false,
        })
    );
}

#[test]
fn save_request_defaults_optional_fields() {
    let request: TextFileSaveRequest =
        serde_json::from_value(json!({ "content": "x" })).expect("parse minimal request");
    assert_eq!(
        request,
        TextFileSaveRequest {
            content: "x".to_string(),
            bom: false,
            expected_mtime_ms: None,
            expected_size: None,
            force: false,
        }
    );
    let full: TextFileSaveRequest = serde_json::from_value(json!({
        "content": "y", "bom": true, "expectedMtimeMs": 5, "expectedSize": 9, "force": true,
    }))
    .expect("parse full request");
    assert_eq!(full.expected_mtime_ms, Some(5));
    assert_eq!(full.expected_size, Some(9));
    assert!(full.bom && full.force);
}

#[test]
fn save_outcome_is_tagged_by_status() {
    let saved = TextFileSaveOutcome::Saved {
        size: 3,
        mtime_ms: 11,
    };
    assert_eq!(
        serde_json::to_value(&saved).expect("serialize saved"),
        json!({ "status": "saved", "size": 3, "mtimeMs": 11 })
    );
    let conflict = TextFileSaveOutcome::Conflict {
        reason: ConflictReason::Modified,
        disk_mtime_ms: Some(12),
    };
    assert_eq!(
        serde_json::to_value(&conflict).expect("serialize conflict"),
        json!({ "status": "conflict", "reason": "modified", "diskMtimeMs": 12 })
    );
    let deleted = TextFileSaveOutcome::Conflict {
        reason: ConflictReason::Deleted,
        disk_mtime_ms: None,
    };
    let value = serde_json::to_value(&deleted).expect("serialize deleted");
    assert_eq!(value, json!({ "status": "conflict", "reason": "deleted" }));
    let back: TextFileSaveOutcome = serde_json::from_value(value).expect("round trip");
    assert_eq!(back, deleted);
}
