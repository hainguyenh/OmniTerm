//! The wire shape of `SessionStatus`, pinned against the JSON the renderer actually reads.
//!
//! Every other test round-trips this type Rust→Rust, which stays green if the serde tag is renamed
//! or `rename_all` is dropped. The frontend does not: `ui/tauriSessions.ts` switches on
//! `status.kind` and reads `label` / `message` / `code` / `busy` by name, with no fallback. So a tag
//! rename ships a build where every pane sits at `connecting` forever and no Rust test notices.
//! These assertions compare against literal JSON for that reason — a re-serialized Rust value would
//! agree with itself no matter what the contract became.

use super::*;
use serde_json::{json, Value};

fn to_json(status: &SessionStatus) -> Value {
    serde_json::to_value(status).expect("SessionStatus must serialize")
}

#[test]
fn each_variant_serializes_to_the_json_the_renderer_reads() {
    assert_eq!(
        to_json(&SessionStatus::Ready { label: "bash".into() }),
        json!({ "kind": "ready", "label": "bash" })
    );
    assert_eq!(
        to_json(&SessionStatus::Error { message: "host unreachable".into() }),
        json!({ "kind": "error", "message": "host unreachable" })
    );
    assert_eq!(
        to_json(&SessionStatus::Closed { code: 3 }),
        json!({ "kind": "closed", "code": 3 })
    );
    assert_eq!(
        to_json(&SessionStatus::Activity { busy: true }),
        json!({ "kind": "activity", "busy": true })
    );
}

/// The discriminant key and the variant spellings are the contract, not an implementation detail.
#[test]
fn the_tag_is_named_kind_and_the_variants_are_lower_case() {
    let raw = serde_json::to_string(&SessionStatus::Ready { label: "zsh".into() }).unwrap();
    assert!(raw.contains("\"kind\":\"ready\""), "unexpected wire form: {raw}");
    assert!(!raw.contains("\"type\""), "the renderer switches on `kind`: {raw}");
}

/// A clean exit is code 0, and the renderer reads `status.code` unconditionally — so the field must
/// be present, not skipped for being the default.
#[test]
fn a_zero_exit_code_is_emitted_rather_than_omitted() {
    let value = to_json(&SessionStatus::Closed { code: 0 });
    assert_eq!(value.get("code"), Some(&json!(0)));
}

#[test]
fn every_variant_round_trips() {
    for status in [
        SessionStatus::Ready { label: "pwsh".into() },
        SessionStatus::Error { message: String::new() },
        SessionStatus::Closed { code: u32::MAX },
        SessionStatus::Activity { busy: false },
    ] {
        let decoded: SessionStatus = serde_json::from_value(to_json(&status)).unwrap();
        assert_eq!(decoded, status);
    }
}

/// Malformed input must fail loudly. Silently defaulting would turn a protocol mismatch into a pane
/// stuck in the wrong state, which is far harder to trace back than a deserialize error.
#[test]
fn unknown_and_incomplete_payloads_are_rejected() {
    let unknown_kind = json!({ "kind": "started", "label": "bash" });
    let missing_label = json!({ "kind": "ready" });
    let untagged = json!({ "label": "bash" });

    for payload in [unknown_kind, missing_label, untagged] {
        assert!(
            serde_json::from_value::<SessionStatus>(payload.clone()).is_err(),
            "{payload} should not deserialize"
        );
    }
}
