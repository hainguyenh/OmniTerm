use serde_json::json;

use super::super::agy_provider::fetch_agy_usage;
use super::super::fake_deps::{home, now, FakeDeps};
use super::*;

fn input() -> Value {
    json!({
        "model": { "id": "gemini-3-pro" },
        "quota": {
            "gemini-weekly": { "remaining_fraction": 0.75, "reset_time": "2099-01-01T00:00:00Z" },
            "gemini-5h": { "remaining_fraction": 0.4, "reset_in_seconds": 3600 },
            "claude-weekly": { "remaining_fraction": 0.1, "reset_time": "2099-01-01T00:00:00Z" },
            "credits": { "remaining_amount": 12 },
            "old-weekly": { "remaining_fraction": 0.0, "disabled": true },
        }
    })
}

#[test]
fn keeps_each_bucket_with_a_fraction_as_a_used_percentage() {
    let record = agy_usage_record(&input(), now()).expect("record");
    let buckets = record["buckets"].as_object().expect("buckets");
    assert_eq!(
        buckets.len(),
        3,
        "no amount-only or disabled bucket: {record}"
    );
    assert_eq!(buckets["gemini-weekly"]["used_percentage"], 25.0);
    assert_eq!(
        buckets["gemini-5h"]["resets_at"],
        json!(now() + 3_600_000),
        "a reset in seconds is counted from now"
    );
    assert_eq!(record["model"], "gemini-3-pro");
}

#[test]
fn an_input_without_quota_is_no_record() {
    assert_eq!(agy_usage_record(&json!({ "cwd": "x" }), now()), None);
    assert_eq!(agy_usage_record(&json!({ "quota": {} }), now()), None);
}

#[test]
fn reads_the_record_for_the_running_model_family() {
    let record = agy_usage_record(&input(), now()).expect("record");
    let snapshot = parse_agy_record(&record.to_string(), now(), None).expect("reading");
    assert_eq!(snapshot.source, Some(QuotaSource::Statusline));
    let weekly = snapshot
        .windows
        .iter()
        .find(|window| window.kind == WindowKind::Weekly)
        .expect("weekly");
    assert_eq!(weekly.used_pct, 25.0, "gemini runs, so its bucket leads");
    assert_eq!(weekly.breakdown.as_ref().map(Vec::len), Some(2));
    let claude =
        parse_agy_record(&record.to_string(), now(), Some(ModelFamily::Claude)).expect("reading");
    assert!(claude
        .windows
        .iter()
        .any(|window| window.kind == WindowKind::Weekly && window.used_pct == 90.0));
}

#[test]
fn a_stale_future_or_rolled_over_record_is_no_reading() {
    let record = agy_usage_record(&input(), now())
        .expect("record")
        .to_string();
    assert!(parse_agy_record(&record, now() + MAX_AGE_MS + 1, None).is_none());
    assert!(parse_agy_record(&record, now() - 5 * 60 * 1000, None).is_none());
    assert!(
        parse_agy_record(&record, now() + 3_600_000, None).is_none(),
        "the 5-hour window reset at that moment"
    );
    assert!(parse_agy_record("not json", now(), None).is_none());
}

#[test]
fn prints_a_short_line_or_waits() {
    let record = agy_usage_record(&input(), now()).expect("record");
    assert_eq!(
        agy_status_text(Some(&record), now()),
        "Quota 5h 60% · wk 25%"
    );
    assert_eq!(
        agy_status_text(None, now()),
        "Quota: waiting for Antigravity"
    );
}

#[test]
fn the_provider_uses_a_fresh_record_without_running_the_cli() {
    let record = agy_usage_record(&input(), now())
        .expect("record")
        .to_string();
    let file = agy_usage_file(&home().join(".gemini"));
    let deps = FakeDeps::new(&[(file, record.as_str())]);
    let snapshot = fetch_agy_usage(None, None, None, &deps);
    assert_eq!(snapshot.source, Some(QuotaSource::Statusline));
    assert_eq!(deps.run_count(), 0);
}

#[test]
fn a_launcher_without_a_folder_has_no_record_home() {
    assert_eq!(agy_home(None, Some("agy-work"), &home()), None);
    assert_eq!(agy_home(None, None, &home()), Some(home().join(".gemini")));
}
