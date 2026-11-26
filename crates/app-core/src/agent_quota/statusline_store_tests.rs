use serde_json::json;

use super::super::claude_bridge::bridge_file;
use super::super::claude_bridge_run::statusline_output;
use super::*;

const NOW: i64 = 1_790_000_000_000;
const SESSION: &str = "11111111-1111-4111-8111-111111111111";

fn no_chain(_: &str, _: &str) -> Option<String> {
    None
}

#[test]
fn accepts_only_ids_that_are_safe_file_names() {
    assert_eq!(safe_session_id(SESSION), Some(SESSION));
    assert_eq!(safe_session_id("ses_Ab-9"), Some("ses_Ab-9"));
    for bad in [
        "",
        "../x",
        "a/b",
        "a\\b",
        "a.json",
        "C:",
        "a b",
        &"x".repeat(129),
    ] {
        assert_eq!(safe_session_id(bad), None, "{bad:?}");
    }
}

#[test]
fn keeps_the_printed_text_per_conversation_and_reads_it_back() {
    let dir = tempfile::tempdir().expect("temp dir");
    let input = json!({ "session_id": SESSION });
    store_statusline(
        dir.path(),
        Some(&input),
        "\u{1b}[32mOpus\u{1b}[0m · 5h 4%\n",
        Some(27.5),
        NOW,
    )
    .expect("store");
    assert_eq!(
        read_statusline(dir.path(), SESSION, NOW + 1000),
        Some(StatuslineRecord {
            text: "\u{1b}[32mOpus\u{1b}[0m · 5h 4%\n".to_string(),
            context_pct: Some(27.5),
        })
    );
    let file = dir
        .path()
        .join("omniterm")
        .join("statuslines")
        .join(format!("{SESSION}.json"));
    assert!(file.is_file());
    assert_eq!(read_statusline(dir.path(), "22222222-x", NOW), None);
}

#[test]
fn writes_nothing_without_a_usable_session_id() {
    let dir = tempfile::tempdir().expect("temp dir");
    for input in [
        None,
        Some(json!({})),
        Some(json!({ "session_id": "../evil" })),
    ] {
        store_statusline(dir.path(), input.as_ref(), "line", None, NOW).expect("no error");
    }
    assert!(!dir.path().join("omniterm").exists());
}

#[test]
fn a_stale_future_blank_or_malformed_record_is_no_status_line() {
    let record = |written: i64, text: &str| {
        json!({ "version": 1, "writtenAt": written, "text": text }).to_string()
    };
    assert_eq!(
        parse_statusline_record(&record(NOW, "a"), NOW),
        Some(StatuslineRecord {
            text: "a".to_string(),
            context_pct: None,
        })
    );
    // A context share out of range is clamped; one that is not a number is no share.
    let read = |pct: Value| {
        let raw = json!({ "writtenAt": NOW, "text": "a", "contextPct": pct }).to_string();
        parse_statusline_record(&raw, NOW).and_then(|record| record.context_pct)
    };
    assert_eq!(read(json!(140.0)), Some(100.0));
    assert_eq!(read(json!("12")), None);
    assert_eq!(
        parse_statusline_record(&record(NOW - MAX_AGE_MS - 1, "a"), NOW),
        None
    );
    assert_eq!(
        parse_statusline_record(&record(NOW + 2 * 60 * 1000, "a"), NOW),
        None
    );
    assert_eq!(parse_statusline_record(&record(NOW, " \n"), NOW), None);
    assert_eq!(parse_statusline_record("not json", NOW), None);
    assert_eq!(parse_statusline_record("{\"text\":\"a\"}", NOW), None);
}

#[test]
fn cuts_a_very_long_text() {
    let dir = tempfile::tempdir().expect("temp dir");
    let input = json!({ "session_id": SESSION });
    store_statusline(dir.path(), Some(&input), &"é".repeat(5000), None, NOW).expect("store");
    let text = read_statusline(dir.path(), SESSION, NOW)
        .expect("text")
        .text;
    assert_eq!(text.chars().count(), MAX_TEXT_CHARS);
}

#[test]
fn prunes_only_old_records() {
    let dir = tempfile::tempdir().expect("temp dir");
    std::fs::write(dir.path().join("a.json"), "{}").expect("write");
    prune(dir.path(), SystemTime::now());
    assert!(dir.path().join("a.json").exists(), "a fresh record stays");
    prune(dir.path(), SystemTime::now() + PRUNE_AFTER * 2);
    assert!(!dir.path().join("a.json").exists(), "an old record goes");
}

#[test]
fn the_bridge_stores_what_it_prints_chained_or_its_own() {
    let dir = tempfile::tempdir().expect("temp dir");
    let input = json!({
        "session_id": SESSION,
        "rate_limits": { "five_hour": { "used_percentage": 42.0, "resets_at": 1_790_003_600 } },
    })
    .to_string();
    let own = statusline_output(dir.path(), &input, NOW, &no_chain);
    assert_eq!(
        read_statusline(dir.path(), SESSION, NOW).map(|record| record.text),
        Some(own)
    );

    let previous = json!({ "previousStatusLine": { "command": "my-line" } });
    write_atomic(&bridge_file(dir.path()), &previous.to_string()).expect("bridge.json");
    let chained = |_: &str, _: &str| Some("my line\n".to_string());
    statusline_output(dir.path(), &input, NOW, &chained);
    assert_eq!(
        read_statusline(dir.path(), SESSION, NOW)
            .map(|record| record.text)
            .as_deref(),
        Some("my line\n")
    );
}
