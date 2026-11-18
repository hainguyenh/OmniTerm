use serde_json::json;

use super::*;

const NOW: i64 = 1_790_000_000_000;
const RESET_S: i64 = 1_790_003_600;

fn input(five: f64, week: f64) -> Value {
    json!({
        "session_id": "s1",
        "cost": { "total_cost_usd": 1.25 },
        "rate_limits": {
            "five_hour": { "used_percentage": five, "resets_at": RESET_S },
            "seven_day": { "used_percentage": week, "resets_at": RESET_S + 86_400 },
        },
    })
}

fn record(five: f64, week: f64, written: i64) -> String {
    usage_record(&input(five, week), written)
        .expect("a record")
        .to_string()
}

#[test]
fn keeps_only_the_rate_limit_windows_of_the_status_line_input() {
    let kept = usage_record(&input(42.0, 13.0), NOW).expect("a record");
    assert_eq!(kept["writtenAt"], NOW);
    assert_eq!(kept["rateLimits"]["five_hour"]["used_percentage"], 42.0);
    assert_eq!(
        kept["rateLimits"]["seven_day"]["resets_at"],
        (RESET_S + 86_400) as f64
    );
    assert!(
        kept.get("cost").is_none(),
        "nothing but the windows is stored"
    );
}

#[test]
fn stores_nothing_before_the_first_reply_or_without_numeric_windows() {
    assert_eq!(usage_record(&json!({ "session_id": "s1" }), NOW), None);
    assert_eq!(usage_record(&json!({ "rate_limits": {} }), NOW), None);
    let text = json!({ "rate_limits": { "five_hour": { "used_percentage": "high" } } });
    assert_eq!(usage_record(&text, NOW), None);
}

#[test]
fn reads_a_fresh_record_as_a_statusline_reading_in_milliseconds() {
    let snapshot = parse_usage_record(&record(42.0, 13.0, NOW - 1_000), NOW).expect("a reading");
    assert_eq!(snapshot.source, Some(QuotaSource::Statusline));
    assert_eq!(snapshot.fetched_at, NOW - 1_000);
    assert_eq!(
        snapshot
            .windows
            .iter()
            .map(|window| (window.kind, window.used_pct, window.resets_at))
            .collect::<Vec<_>>(),
        [
            (WindowKind::Session, 42.0, Some(RESET_S * 1000)),
            (WindowKind::Weekly, 13.0, Some((RESET_S + 86_400) * 1000)),
        ]
    );
}

#[test]
fn distrusts_old_future_malformed_and_rolled_over_records() {
    assert_eq!(
        parse_usage_record(&record(42.0, 13.0, NOW - MAX_AGE_MS - 1), NOW),
        None
    );
    assert_eq!(
        parse_usage_record(&record(42.0, 13.0, NOW + 120_000), NOW),
        None
    );
    assert_eq!(parse_usage_record("not json", NOW), None);
    assert_eq!(
        parse_usage_record(&json!({ "writtenAt": NOW }).to_string(), NOW),
        None
    );
    // Written before the 5-hour reset, read after it: the percentage belongs to the old window.
    let after_reset = RESET_S * 1000 + 1;
    assert_eq!(
        parse_usage_record(&record(42.0, 13.0, after_reset - 1_000), after_reset),
        None
    );
}

#[test]
fn clamps_percentages_and_ignores_unusable_resets() {
    let raw = json!({
        "writtenAt": NOW,
        "rateLimits": { "five_hour": { "used_percentage": 140.0, "resets_at": null } },
    })
    .to_string();
    let snapshot = parse_usage_record(&raw, NOW).expect("a reading");
    assert_eq!(snapshot.windows[0].used_pct, 100.0);
    assert_eq!(snapshot.windows[0].resets_at, None);
}

#[test]
fn prints_a_short_quota_line() {
    let kept = usage_record(&input(42.4, 13.0), NOW);
    assert_eq!(status_text(kept.as_ref()), "5h 42% · 7d 13%");
    assert_eq!(
        status_text(None),
        "Claude quota: waiting for the first reply"
    );
}

#[test]
fn guards_with_the_apps_claude_limits_or_its_defaults() {
    assert_eq!(guard_limits(None), Some(DEFAULT_LIMITS));
    assert_eq!(guard_limits(Some("not json")), Some(DEFAULT_LIMITS));
    let settings = json!({ "agentQuota": { "agents": { "claude": { "limits": { "session": 70, "weekly": 2 } } } } });
    assert_eq!(
        guard_limits(Some(&settings.to_string())),
        Some(GuardLimits {
            session: 70.0,
            weekly: 5.0
        })
    );
}

#[test]
fn does_not_guard_when_quota_monitoring_or_suspend_is_off() {
    for settings in [
        json!({ "agentQuota": { "enabled": false } }),
        json!({ "agentQuota": { "agents": { "claude": { "enabled": false } } } }),
        json!({ "agentQuota": { "agents": { "claude": { "suspendAtLimit": false } } } }),
    ] {
        assert_eq!(
            guard_limits(Some(&settings.to_string())),
            None,
            "{settings}"
        );
    }
}

#[test]
fn blocks_a_sub_agent_only_at_or_over_a_limit() {
    let limits = GuardLimits {
        session: 90.0,
        weekly: 95.0,
    };
    let reading =
        |five, week| parse_usage_record(&record(five, week, NOW), NOW).expect("a reading");
    assert_eq!(blocked_reason(&reading(89.9, 94.0), limits), None);
    let session = blocked_reason(&reading(90.0, 10.0), limits).expect("blocked");
    assert!(
        session.contains("5-hour quota is at 90% (limit 90%)"),
        "{session}"
    );
    let weekly = blocked_reason(&reading(10.0, 97.0), limits).expect("blocked");
    assert!(
        weekly.contains("weekly quota is at 97% (limit 95%)"),
        "{weekly}"
    );
}

#[test]
fn keeps_its_files_in_the_profiles_omniterm_folder() {
    let profile = Path::new("profile");
    assert_eq!(
        usage_file(profile),
        profile.join("omniterm").join("claude-usage.json")
    );
    assert_eq!(
        bridge_file(profile),
        profile.join("omniterm").join("bridge.json")
    );
}
