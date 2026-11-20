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

fn sessions() -> PathBuf {
    codex().join("sessions")
}

fn primary_used(reading: Option<RolloutReading>) -> Option<f64> {
    reading.map(|reading| reading.windows[0].used_pct)
}

#[test]
fn picks_the_most_recently_modified_rollout_of_the_newest_day_that_has_one() {
    let a = event(now() - 3000, &rate_limits(10.0, 1.0));
    let b = event(now() - 2000, &rate_limits(20.0, 1.0));
    let c = event(now() - 1000, &rate_limits(30.0, 1.0));
    let deps = FakeDeps::new(&[
        (rollout_file("25", "rollout-a.jsonl"), a.as_str()),
        (rollout_file("25", "rollout-b.jsonl"), b.as_str()),
        (rollout_file("25", "rollout-c.jsonl"), c.as_str()),
        (rollout_file("25", "rollout-d.txt"), c.as_str()),
        (rollout_file("25", "notes.jsonl"), c.as_str()),
        (rollout_file("26", "readme.md"), ""),
        (
            sessions().join("latest").join("rollout-z.jsonl"),
            c.as_str(),
        ),
    ])
    .with_mtime(|file| {
        let name = file
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
        Ok(Some(match name.as_deref() {
            Some("rollout-a.jsonl") => 100,
            Some("rollout-b.jsonl") => 200,
            _ => 50,
        }))
    });
    // Day 26 holds no rollout and `latest` is not a year, so day 25's newest file is read.
    assert_eq!(
        primary_used(read_latest_rollout(&codex(), &deps).expect("readable")),
        Some(20.0)
    );
}

#[test]
fn reports_a_failure_at_any_depth_of_the_session_tree() {
    let day = sessions().join("2026").join("09").join("25");
    let failing = [
        sessions().join("2026"),
        sessions().join("2026").join("09"),
        day.clone(),
    ];
    for broken in failing {
        let listed_day = day.clone();
        let deps = FakeDeps::new(&[]).listing(move |dir| {
            if dir == broken {
                return Err(io::Error::other("unreadable"));
            }
            let parent = listed_day.parent().map(Path::to_path_buf);
            let next = [
                (sessions(), "2026"),
                (sessions().join("2026"), "09"),
                (parent.unwrap_or_default(), "25"),
                (listed_day.clone(), "rollout-a.jsonl"),
            ]
            .into_iter()
            .find(|(known, _)| known == dir)
            .map(|(_, name)| vec![name.to_string()]);
            Ok(next.unwrap_or_default())
        });
        assert_eq!(
            read_latest_rollout(&codex(), &deps)
                .expect_err("unreadable")
                .to_string(),
            "unreadable"
        );
    }
    let text = event(now(), &rate_limits(1.0, 1.0));
    let deps = FakeDeps::new(&[(rollout_file("25", "rollout-a.jsonl"), text.as_str())])
        .with_mtime(|_| Err(io::Error::other("no stat")));
    assert_eq!(
        read_latest_rollout(&codex(), &deps)
            .expect_err("unreadable")
            .to_string(),
        "no stat"
    );
}

#[test]
fn returns_none_when_the_newest_rollout_cannot_be_read() {
    let day = sessions().join("2026").join("09").join("25");
    let deps = FakeDeps::new(&[]).listing(move |dir| {
        let name = if dir == sessions() {
            "2026"
        } else if dir == sessions().join("2026") {
            "09"
        } else if dir == sessions().join("2026").join("09") {
            "25"
        } else if dir == day {
            "rollout-a.jsonl"
        } else {
            return Ok(Vec::new());
        };
        Ok(vec![name.to_string()])
    });
    assert_eq!(
        read_latest_rollout(&codex(), &deps).expect("readable"),
        None
    );
}

#[test]
fn skips_events_without_a_usable_rate_limits_payload() {
    let good = event(now() - 5000, &rate_limits(12.0, 1.0));
    let lines = [
        good,
        json!({ "timestamp": "2026-09-25T02:00:00Z", "rate_limits": {} }).to_string(),
        json!({ "timestamp": "2026-09-25T02:00:00Z", "payload": { "x": 1 }, "y": "rate_limits" })
            .to_string(),
        event(now() - 1000, &json!("rate_limits")),
        event(now() - 1000, &json!({ "primary": null })),
    ]
    .join("\n");
    let deps = FakeDeps::new(&[(rollout_file("25", "rollout-a.jsonl"), lines.as_str())]);
    assert_eq!(
        primary_used(read_latest_rollout(&codex(), &deps).expect("readable")),
        Some(12.0)
    );
}

#[test]
fn carries_credits_only_when_the_account_has_them() {
    let credits_of = |credits: Option<Value>| {
        let mut limits = json!({ "primary": { "used_percent": 5 } });
        if let Some(credits) = credits {
            limits["credits"] = credits;
        }
        parse_rate_limits(&limits).expect("a window").1
    };
    assert_eq!(credits_of(None), None);
    assert_eq!(credits_of(Some(json!(5))), None);
    assert_eq!(credits_of(Some(json!({ "has_credits": false }))), None);
    assert_eq!(
        credits_of(Some(json!({ "has_credits": true, "balance": 3 }))),
        Some(QuotaCredits {
            balance: Some(3.0),
            unlimited: false
        })
    );
}

#[test]
fn ignores_session_entries_that_are_not_dated_folders() {
    let deps = FakeDeps::new(&[]).listing(|dir| {
        Ok(if dir == sessions() {
            vec![String::new(), "abc".to_string(), "20x6".to_string()]
        } else {
            vec!["rollout-a.jsonl".to_string()]
        })
    });
    assert_eq!(
        read_latest_rollout(&codex(), &deps).expect("readable"),
        None
    );
}
