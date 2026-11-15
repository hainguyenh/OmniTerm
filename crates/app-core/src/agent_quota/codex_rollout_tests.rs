use std::io;
use std::path::PathBuf;

use serde_json::{json, Value};

use super::super::civil::civil_from_days;
use super::super::fake_deps::{home, now, FakeDeps};
use super::*;

fn codex() -> PathBuf {
    home().join(".codex")
}

fn reset_5h() -> i64 {
    now() / 1000 + 3600
}

fn reset_7d() -> i64 {
    now() / 1000 + 5 * 86400
}

/// Shape copied from a real rollout (event_msg / token_count).
fn rate_limits(primary: f64, secondary: f64) -> Value {
    json!({
        "limit_id": "codex",
        "primary": { "used_percent": primary, "window_minutes": 300, "resets_at": reset_5h() },
        "secondary": { "used_percent": secondary, "window_minutes": 10080, "resets_at": reset_7d() },
        "credits": { "has_credits": false, "unlimited": false, "balance": null },
        "plan_type": "team",
    })
}

fn iso(ms: i64) -> String {
    let (year, month, day) = civil_from_days(ms.div_euclid(86_400_000));
    let of_day = ms.rem_euclid(86_400_000);
    let (hour, minute, second, milli) = (
        of_day / 3_600_000,
        of_day / 60_000 % 60,
        of_day / 1000 % 60,
        of_day % 1000,
    );
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milli:03}Z")
}

fn event(at: i64, limits: &Value) -> String {
    json!({ "timestamp": iso(at), "type": "event_msg", "payload": { "type": "token_count", "rate_limits": limits } }).to_string()
}

fn rollout_file(day: &str, name: &str) -> PathBuf {
    codex()
        .join("sessions")
        .join("2026")
        .join("09")
        .join(day)
        .join(name)
}

fn window(kind: WindowKind, label: &str, used_pct: f64, resets_at: Option<i64>) -> QuotaWindow {
    QuotaWindow {
        kind,
        used_pct,
        resets_at,
        label: label.to_string(),
        breakdown: None,
    }
}

#[test]
fn reads_the_last_rate_limits_event_of_the_newest_day_skipping_a_cut_first_line() {
    let newest = [
        "{\"cut\": tr".to_string(),
        event(now() - 5000, &rate_limits(31.0, 95.0)),
        "{\"type\":\"other\"}".to_string(),
        String::new(),
    ]
    .join("\n");
    let older = event(now() - 86_400_000, &rate_limits(1.0, 2.0));
    let deps = FakeDeps::new(&[
        (rollout_file("24", "rollout-a.jsonl"), older.as_str()),
        (rollout_file("25", "rollout-b.jsonl"), newest.as_str()),
        (rollout_file("25", "notes.txt"), "ignored"),
    ]);
    let reading = read_latest_rollout(&codex(), &deps)
        .expect("readable")
        .expect("a reading");
    assert_eq!(
        reading,
        RolloutReading {
            at: now() - 5000,
            credits: None,
            windows: vec![
                window(
                    WindowKind::Session,
                    "5-hour session",
                    31.0,
                    Some(reset_5h() * 1000)
                ),
                window(WindowKind::Weekly, "Weekly", 95.0, Some(reset_7d() * 1000)),
            ],
        }
    );
}

#[test]
fn returns_none_without_sessions_or_readable_events() {
    assert_eq!(
        read_latest_rollout(&codex(), &FakeDeps::new(&[])).expect("readable"),
        None
    );
    let undated =
        json!({ "timestamp": "garbage", "payload": { "rate_limits": rate_limits(1.0, 1.0) } })
            .to_string();
    let junk = format!("{{\"rate_limits\": broken\n{undated}");
    let deps = FakeDeps::new(&[(rollout_file("25", "rollout-a.jsonl"), junk.as_str())]);
    assert_eq!(
        read_latest_rollout(&codex(), &deps).expect("readable"),
        None
    );
}

#[test]
fn reads_the_newest_rollout_with_credits_and_never_needs_a_token() {
    let mut limits = rate_limits(40.0, 50.0);
    limits["credits"] = json!({ "has_credits": true, "unlimited": false, "balance": "4.5" });
    let text = event(now() - 1000, &limits);
    let deps = FakeDeps::new(&[(rollout_file("25", "rollout-b.jsonl"), text.as_str())]);
    let snapshot = fetch_codex_usage(None, &deps).expect("readable");
    assert_eq!(snapshot.source, Some(QuotaSource::Rollout));
    assert_eq!(
        snapshot
            .windows
            .iter()
            .map(|w| w.used_pct)
            .collect::<Vec<_>>(),
        [40.0, 50.0]
    );
    assert_eq!(
        snapshot.credits,
        Some(QuotaCredits {
            balance: Some(4.5),
            unlimited: false
        })
    );
}

#[test]
fn keeps_an_old_rollout_dropping_windows_whose_reset_has_passed() {
    let mut stale = rate_limits(70.0, 80.0);
    stale["primary"]["resets_at"] = json!(now() / 1000 - 60);
    let text = event(now() - 600_000, &stale);
    let deps = FakeDeps::new(&[(rollout_file("25", "rollout-b.jsonl"), text.as_str())]);
    let snapshot = fetch_codex_usage(Some(&codex()), &deps).expect("readable");
    assert_eq!(
        (snapshot.source, snapshot.windows.len()),
        (Some(QuotaSource::Rollout), 1)
    );
    assert_eq!(
        (snapshot.windows[0].kind, snapshot.windows[0].used_pct),
        (WindowKind::Weekly, 80.0)
    );
}

#[test]
fn says_usage_appears_after_the_first_reply_when_nothing_current_is_recorded() {
    let empty = fetch_codex_usage(Some(&codex()), &FakeDeps::new(&[])).expect("readable");
    assert_eq!(
        (empty.error, empty.message.as_deref()),
        (
            Some(QuotaError::Unsupported),
            Some("Codex usage appears after its first reply.")
        )
    );
    let mut spent = rate_limits(1.0, 1.0);
    spent["primary"]["resets_at"] = json!(1);
    spent["secondary"]["resets_at"] = json!(1);
    let text = event(now() - 600_000, &spent);
    let deps = FakeDeps::new(&[(rollout_file("25", "rollout-b.jsonl"), text.as_str())]);
    assert_eq!(
        fetch_codex_usage(Some(&codex()), &deps)
            .expect("readable")
            .error,
        Some(QuotaError::Unsupported)
    );
}

#[test]
fn reports_an_unreadable_session_tree_to_the_caller() {
    let deps = FakeDeps::new(&[]).listing(|_| Err(io::Error::other("disk gone")));
    assert_eq!(
        fetch_codex_usage(None, &deps)
            .expect_err("unreadable")
            .to_string(),
        "disk gone"
    );
}

#[test]
fn classifies_rate_limits_by_length_and_carries_credits() {
    let parsed = parse_rate_limits(&json!({
        "primary": { "used_percent": 5 },
        "monthly_window": { "used_percent": 9, "limit_window_seconds": 30 * 86400 },
        "credits": { "has_credits": true, "unlimited": true, "balance": null },
    }));
    assert_eq!(
        parsed,
        Some((
            vec![
                window(WindowKind::Session, "5-hour session", 5.0, None),
                window(WindowKind::Monthly, "Monthly", 9.0, None)
            ],
            Some(QuotaCredits {
                balance: None,
                unlimited: true
            }),
        ))
    );
    assert_eq!(parse_rate_limits(&json!({})), None);
    assert_eq!(parse_rate_limits(&json!("nope")), None);
}
