//! The Claude provider reads the status line bridge's record instead of running the CLI, which
//! leaves a throwaway conversation in the profile on every run.

use std::path::PathBuf;

use serde_json::json;

use super::super::claude_bridge::{usage_file, MAX_AGE_MS};
use super::super::fake_deps::{home, now, FakeDeps};
use super::*;

fn record(written: i64) -> String {
    let reset = (now() + 3_600_000) / 1000;
    json!({
        "writtenAt": written,
        "rateLimits": { "five_hour": { "used_percentage": 61.0, "resets_at": reset } },
    })
    .to_string()
}

fn profile() -> PathBuf {
    home().join(".claude-work")
}

#[test]
fn reads_the_bridge_record_without_running_the_cli() {
    let deps = FakeDeps::new(&[(usage_file(&profile()), &record(now() - 5_000))]);
    let snapshot = fetch_claude_usage(Some(&profile()), None, &deps);
    assert_eq!(snapshot.source, Some(QuotaSource::Statusline));
    assert_eq!(snapshot.windows[0].used_pct, 61.0);
    assert!(deps.runs.lock().expect("runs").is_empty(), "no CLI run");
}

#[test]
fn looks_in_the_default_profile_when_no_directory_or_launcher_is_known() {
    let default_dir = home().join(".claude");
    let deps = FakeDeps::new(&[(usage_file(&default_dir), &record(now()))]);
    assert_eq!(
        fetch_claude_usage(None, None, &deps).source,
        Some(QuotaSource::Statusline)
    );
}

#[test]
fn keeps_to_an_old_record_instead_of_running_the_cli() {
    let written = now() - 50 * MAX_AGE_MS;
    let old = FakeDeps::new(&[(usage_file(&profile()), &record(written))]);
    let snapshot = fetch_claude_usage(Some(&profile()), None, &old);
    assert_eq!(snapshot.source, Some(QuotaSource::Statusline));
    assert_eq!(snapshot.fetched_at, written);
    assert!(old.runs.lock().expect("runs").is_empty(), "no CLI run");
}

#[test]
fn asks_the_cli_only_without_a_record_or_a_known_directory() {
    let none = FakeDeps::new(&[]);
    let snapshot = fetch_claude_usage(Some(&profile()), None, &none);
    assert_ne!(snapshot.source, Some(QuotaSource::Statusline));

    // A launcher without a known directory sets its own; the default profile's record is not its.
    let launcher = FakeDeps::new(&[(usage_file(&home().join(".claude")), &record(now()))]);
    let snapshot = fetch_claude_usage(None, Some("claude-work"), &launcher);
    assert_ne!(snapshot.source, Some(QuotaSource::Statusline));
}

#[test]
fn the_service_reads_only_the_bridge_record_and_never_the_cli() {
    use super::super::service::QuotaService;
    use super::super::types::FetchUsageRequest;

    let request = |agent: AgentKind, written: Option<i64>| {
        let files: Vec<(PathBuf, String)> = written
            .map(|at| vec![(usage_file(&profile()), record(at))])
            .unwrap_or_default();
        let borrowed: Vec<(PathBuf, &str)> = files
            .iter()
            .map(|(path, text)| (path.clone(), text.as_str()))
            .collect();
        let service = QuotaService::new(FakeDeps::new(&borrowed));
        service.bridge_reading(&FetchUsageRequest {
            agent,
            profile_dir: Some(profile()),
            launcher: None,
            model_family: None,
            model_family_auto: false,
            max_record_age_ms: None,
        })
    };
    let fresh = request(AgentKind::Claude, Some(now() - 1_000)).expect("the bridge record");
    assert_eq!(fresh.source, Some(QuotaSource::Statusline));
    assert_eq!(fresh.fetched_at, now() - 1_000);
    let old = request(AgentKind::Claude, Some(now() - MAX_AGE_MS - 1)).expect("an old record");
    assert_eq!(old.fetched_at, now() - MAX_AGE_MS - 1);
    assert_eq!(request(AgentKind::Claude, None), None);
    assert_eq!(request(AgentKind::Codex, Some(now())), None);
}

#[test]
fn asks_the_cli_when_the_record_is_older_than_the_caller_takes() {
    let written = now() - 5 * 60_000;
    let deps = FakeDeps::new(&[(usage_file(&profile()), &record(written))]);
    let young = fetch_claude_usage_within(Some(&profile()), None, Some(10 * 60_000), &deps);
    assert_eq!(young.source, Some(QuotaSource::Statusline));
    let strict = fetch_claude_usage_within(Some(&profile()), None, Some(2 * 60_000), &deps);
    assert_ne!(
        strict.source,
        Some(QuotaSource::Statusline),
        "five minutes is too old for a two-minute limit"
    );
}

#[test]
fn reads_the_record_age_limit_from_the_request() {
    use super::super::service::parse_fetch_request;

    let limited = parse_fetch_request(&json!({ "agent": "claude", "maxRecordAgeMs": 120_000 }))
        .expect("valid");
    assert_eq!(limited.max_record_age_ms, Some(120_000));
    for value in [json!(-1), json!("soon"), json!(null)] {
        let request = parse_fetch_request(&json!({ "agent": "claude", "maxRecordAgeMs": value }))
            .expect("valid");
        assert_eq!(request.max_record_age_ms, None, "{value}");
    }
}
