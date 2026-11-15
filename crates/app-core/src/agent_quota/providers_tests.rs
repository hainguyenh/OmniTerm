//! Claude and Antigravity CLI providers against recorded CLI runs.

use std::path::PathBuf;

use serde_json::json;

use super::super::agy_provider::{detect_agy_active_family, fetch_agy_usage};
use super::super::civil::utc_ms;
use super::super::deps::CliResult;
use super::super::fake_deps::{home, now, ok, FakeDeps};
use super::super::types::ModelFamily;
use super::*;

const USAGE: &str = include_str!("fixtures/claude-usage/current-2026-09.txt");
const AGY_USAGE: &str = "Quota:
Gemini Models          Weekly Limit Remaining     55%   2026-10-02T08:47:03Z
Gemini Models          Five Hour Limit Remaining  82%   2026-09-28T07:11:00Z
Claude and GPT models  Weekly Limit Remaining     100%  2026-10-05T03:34:51Z
Claude and GPT models  Five Hour Limit Remaining  100%  2026-09-28T08:34:51Z";
const AGY_SPLIT: &str =
    "Gemini Models          Five Hour Limit Remaining  40%   2026-09-28T07:11:00Z
Gemini Models          Weekly Limit Remaining     60%   2026-10-02T08:47:03Z
Claude and GPT models  Five Hour Limit Remaining  0%    2026-09-28T08:34:51Z
Claude and GPT models  Weekly Limit Remaining     10%   2026-10-05T03:34:51Z";

fn profile() -> PathBuf {
    home().join("claude-profiles").join("claude-work")
}

fn claude_exe() -> PathBuf {
    home().join(".local").join("bin").join("claude.exe")
}

fn agy_exe() -> PathBuf {
    home().join(".local").join("bin").join("agy.exe")
}

fn has_env(options: &CliOptions, key: &str) -> Option<String> {
    options
        .env
        .get(std::ffi::OsStr::new(key))
        .map(|value| value.to_string_lossy().into_owned())
}

fn timed_out(_: usize) -> CliResult {
    CliResult {
        timed_out: true,
        ..CliResult::default()
    }
}

#[test]
fn claude_runs_the_profile_launcher_the_terminal_used_leaving_the_profile_to_it() {
    let launcher = home().join(".local").join("bin").join("claude-th.cmd");
    let deps = FakeDeps::new(&[])
        .running(|_| ok(USAGE))
        .resolving(claude_exe())
        .with_launcher(&launcher)
        .with_env(&[("PATH", ""), ("CLAUDE_CONFIG_DIR", r"C:\elsewhere")]);
    let snapshot = fetch_claude_usage(Some(&profile()), Some("claude-th"), &deps);
    assert_eq!(
        (snapshot.source, snapshot.fetched_at),
        (Some(QuotaSource::Cli), now())
    );
    assert_eq!(
        snapshot
            .windows
            .iter()
            .map(|w| w.used_pct)
            .collect::<Vec<_>>(),
        [46.0, 87.0]
    );
    assert_eq!(
        deps.launcher_lookups.lock().expect("lookups").as_slice(),
        ["claude-th"]
    );
    let (exe, args, options) = deps.run(0);
    assert_eq!(
        (exe, args),
        (launcher, vec!["-p".to_string(), "/usage".to_string()])
    );
    assert_eq!(has_env(&options, "CLAUDE_CONFIG_DIR"), None);
    assert_eq!(options.cwd, Some(deps.tmp.clone()));
}

#[test]
fn claude_falls_back_to_the_cli_with_the_profile_directory_without_a_usable_launcher() {
    let deps = FakeDeps::new(&[])
        .running(|_| ok(USAGE))
        .resolving(claude_exe());
    fetch_claude_usage(Some(&profile()), Some("claude-gone"), &deps);
    fetch_claude_usage(Some(&profile()), Some("not a launcher"), &deps);
    for index in 0..deps.run_count() {
        let (exe, _, options) = deps.run(index);
        assert_eq!(exe, claude_exe());
        assert_eq!(
            has_env(&options, "CLAUDE_CONFIG_DIR"),
            Some(profile().display().to_string())
        );
    }
}

#[test]
fn claude_unsets_the_variable_for_the_default_profile() {
    let deps = FakeDeps::new(&[])
        .running(|_| ok(USAGE))
        .resolving(claude_exe())
        .with_env(&[("CLAUDE_CONFIG_DIR", "x")]);
    fetch_claude_usage(None, None, &deps);
    assert_eq!(has_env(&deps.run(0).2, "CLAUDE_CONFIG_DIR"), None);
}

#[test]
fn claude_retries_once_logs_a_redacted_sample_then_reports_parse_failed() {
    let deps = FakeDeps::new(&[])
        .running(|_| ok("something new"))
        .resolving(claude_exe());
    let snapshot = fetch_claude_usage(Some(&profile()), None, &deps);
    assert_eq!(
        (snapshot.error, snapshot.windows.len()),
        (Some(QuotaError::ParseFailed), 0)
    );
    assert_eq!(deps.run_count(), 2);
    assert!(deps.logged("unrecognised claude /usage output"));
}

#[test]
fn claude_falls_back_to_the_reading_cached_in_the_profile_config() {
    let config = json!({
        "cachedUsageUtilization": {
            "fetchedAtMs": now() - 60_000,
            "accountUuid": "uuid",
            "utilization": {
                "five_hour": { "utilization": 12, "resets_at": "2026-09-25T05:59:00.000Z", "limit_dollars": null },
                "seven_day": { "utilization": 41, "resets_at": "2026-09-30T02:00:00.000Z", "limit_dollars": null },
                "extra_usage": { "is_enabled": false, "monthly_limit": null, "used_credits": null },
            },
        },
        "projects": { "D:/work": { "hasTrustDialogAccepted": true } },
    })
    .to_string();
    let deps = FakeDeps::new(&[(profile().join(".claude.json"), config.as_str())])
        .running(|_| ok("What's contributing to your limits usage?"))
        .resolving(claude_exe());
    let snapshot = fetch_claude_usage(Some(&profile()), None, &deps);
    assert_eq!(
        snapshot,
        QuotaSnapshot::reading(
            now() - 60_000,
            QuotaSource::Cli,
            vec![
                QuotaWindow {
                    kind: WindowKind::Session,
                    used_pct: 12.0,
                    resets_at: Some(utc_ms(2026, 9, 25, 5, 59)),
                    label: "5-hour limit".into(),
                    breakdown: None
                },
                QuotaWindow {
                    kind: WindowKind::Weekly,
                    used_pct: 41.0,
                    resets_at: Some(utc_ms(2026, 9, 30, 2, 0)),
                    label: "Weekly limit".into(),
                    breakdown: None
                },
            ]
        )
    );
    // The probe runs in a folder the profile already trusts, so no trust prompt blocks it.
    assert_eq!(deps.run(0).2.cwd, Some(PathBuf::from("D:/work")));
}

#[test]
fn claude_reads_the_flat_cached_shape_and_its_credits_from_the_home_config() {
    let config = json!({
        "fetchedAtMs": 1_234_567,
        "cachedUsageUtilization": {
            "five_hour": { "utilization": 12, "resets_at": "2026-09-30T00:00:00.000Z" },
            "seven_day": { "utilization": 45, "resets_at": "2026-10-05T00:00:00.000Z" },
            "extra_usage": { "monthly_limit": 50, "used_credits": 20 },
        },
    })
    .to_string();
    let deps = FakeDeps::new(&[(home().join(".claude.json"), config.as_str())])
        .running(|_| ok("Quick safety check: Do you trust this folder?"))
        .resolving("claude");
    let snapshot = fetch_claude_usage(Some(&profile()), None, &deps);
    assert_eq!(
        (snapshot.fetched_at, snapshot.source),
        (1_234_567, Some(QuotaSource::Cli))
    );
    assert_eq!(
        snapshot
            .windows
            .iter()
            .map(|w| (w.kind, w.used_pct))
            .collect::<Vec<_>>(),
        [(WindowKind::Session, 12.0), (WindowKind::Weekly, 45.0)]
    );
    assert_eq!(
        snapshot.credits,
        Some(QuotaCredits {
            balance: Some(30.0),
            unlimited: false
        })
    );
}

#[test]
fn claude_reports_timeouts_and_a_signed_out_profile_without_retrying_it() {
    let timeout = FakeDeps::new(&[])
        .running(timed_out)
        .resolving(claude_exe());
    assert_eq!(
        fetch_claude_usage(Some(&profile()), None, &timeout).error,
        Some(QuotaError::Timeout)
    );
    let signed_out = FakeDeps::new(&[])
        .running(|_| CliResult {
            code: Some(1),
            stderr: "Please run /login".into(),
            ..CliResult::default()
        })
        .resolving(claude_exe());
    assert_eq!(
        fetch_claude_usage(Some(&profile()), None, &signed_out).error,
        Some(QuotaError::NotSignedIn)
    );
    assert_eq!(signed_out.run_count(), 1);
    let missing = fetch_claude_usage(Some(&profile()), None, &FakeDeps::new(&[]));
    assert_eq!(
        (missing.error, missing.message.as_deref()),
        (
            Some(QuotaError::Unsupported),
            Some("Claude Code CLI not found.")
        )
    );
}

#[test]
fn redacts_emails_and_token_shaped_strings_and_caps_length() {
    let sample = redact_sample(&format!(
        "me@example.com sk-ant-abcdefgh1234 {} {}",
        "A".repeat(40),
        "x".repeat(2000)
    ));
    assert!(sample.contains("<email>"));
    assert!(!sample.contains("sk-ant"));
    assert!(!sample.contains(&"A".repeat(40)));
    assert!(sample.chars().count() <= 1024);
}

#[test]
fn agy_runs_print_mode_usage_with_a_long_timeout_in_the_scratch_directory() {
    let deps = FakeDeps::new(&[])
        .running(|_| ok(AGY_USAGE))
        .resolving(agy_exe());
    let snapshot = fetch_agy_usage(None, None, None, &deps);
    assert_eq!(
        (snapshot.source, snapshot.fetched_at),
        (Some(QuotaSource::Cli), now())
    );
    assert_eq!(
        snapshot
            .windows
            .iter()
            .map(|w| (w.kind, w.used_pct))
            .collect::<Vec<_>>(),
        [(WindowKind::Session, 18.0), (WindowKind::Weekly, 45.0)]
    );
    let (exe, args, options) = deps.run(0);
    assert_eq!(
        (exe, args),
        (agy_exe(), vec!["-p".to_string(), "/usage".to_string()])
    );
    assert!(options.timeout.as_secs() >= 30);
    assert_eq!(options.cwd, Some(deps.tmp.clone()));
}

#[test]
fn agy_runs_through_a_launcher_when_provided() {
    let launcher = home().join(".local").join("bin").join("agy-work.cmd");
    let deps = FakeDeps::new(&[])
        .running(|_| ok(AGY_USAGE))
        .resolving(agy_exe())
        .with_launcher(&launcher);
    fetch_agy_usage(None, Some("agy-work"), None, &deps);
    assert_eq!(
        deps.launcher_lookups.lock().expect("lookups").as_slice(),
        ["agy-work"]
    );
    assert_eq!(deps.run(0).0, launcher);
}

#[test]
fn agy_retries_once_logs_and_reports_failures_without_crashing() {
    let unknown = FakeDeps::new(&[])
        .running(|_| ok("something unexpected"))
        .resolving(agy_exe());
    assert_eq!(
        fetch_agy_usage(None, None, None, &unknown).error,
        Some(QuotaError::ParseFailed)
    );
    assert_eq!(unknown.run_count(), 2);
    assert!(unknown.logged("unrecognised agy -p /usage output"));
    let timeout = FakeDeps::new(&[]).running(timed_out).resolving(agy_exe());
    assert_eq!(
        fetch_agy_usage(None, None, None, &timeout).error,
        Some(QuotaError::Timeout)
    );
    let signed_out = FakeDeps::new(&[])
        .running(|_| CliResult {
            stderr: "Please run /login to continue".into(),
            ..ok("")
        })
        .resolving(agy_exe());
    assert_eq!(
        fetch_agy_usage(None, None, None, &signed_out).error,
        Some(QuotaError::NotSignedIn)
    );
    assert_eq!(signed_out.run_count(), 1);
    let missing = fetch_agy_usage(None, None, None, &FakeDeps::new(&[]));
    assert_eq!(
        missing.message.as_deref(),
        Some("Antigravity CLI not found.")
    );
}

#[test]
fn agy_detects_the_active_model_family_from_its_settings() {
    let gemini = home()
        .join(".gemini")
        .join("antigravity-cli")
        .join("settings.json");
    let model = json!({ "model": "gemini-2.5-pro" }).to_string();
    assert_eq!(
        detect_agy_active_family(None, &FakeDeps::new(&[(gemini, model.as_str())])),
        Some(ModelFamily::Gemini)
    );
    let claude = home().join(".gemini").join("settings.json");
    let model = json!({ "model": "claude-3-7-sonnet" }).to_string();
    assert_eq!(
        detect_agy_active_family(None, &FakeDeps::new(&[(claude, model.as_str())])),
        Some(ModelFamily::Claude)
    );
    assert_eq!(detect_agy_active_family(None, &FakeDeps::new(&[])), None);
}

#[test]
fn agy_selects_the_family_requested_or_detected() {
    let deps = FakeDeps::new(&[])
        .running(|_| ok(AGY_SPLIT))
        .resolving(agy_exe());
    assert_eq!(
        fetch_agy_usage(None, None, Some(ModelFamily::Gemini), &deps).windows[0].used_pct,
        60.0
    );
    assert_eq!(
        fetch_agy_usage(None, None, Some(ModelFamily::Claude), &deps).windows[0].used_pct,
        100.0
    );
    let settings = home().join(".gemini").join("settings.json");
    let model = json!({ "model": "claude-3-5-sonnet" }).to_string();
    let detected = FakeDeps::new(&[(settings, model.as_str())])
        .running(|_| ok(AGY_SPLIT))
        .resolving(agy_exe());
    assert_eq!(
        fetch_agy_usage(None, None, None, &detected).windows[0].used_pct,
        100.0
    );
}
