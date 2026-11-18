//! The Claude provider prefers the status line bridge's fresh record over running the CLI.

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
fn asks_the_cli_when_the_record_is_stale_or_the_directory_unknown() {
    let stale = FakeDeps::new(&[(usage_file(&profile()), &record(now() - MAX_AGE_MS - 1))]);
    let snapshot = fetch_claude_usage(Some(&profile()), None, &stale);
    assert_ne!(snapshot.source, Some(QuotaSource::Statusline));

    // A launcher without a known directory sets its own; the default profile's record is not its.
    let launcher = FakeDeps::new(&[(usage_file(&home().join(".claude")), &record(now()))]);
    let snapshot = fetch_claude_usage(None, Some("claude-work"), &launcher);
    assert_ne!(snapshot.source, Some(QuotaSource::Statusline));
}
