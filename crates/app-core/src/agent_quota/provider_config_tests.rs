//! The profile config files the Claude and Antigravity providers read besides the CLI output.

use std::path::{Path, PathBuf};

use serde_json::json;

use super::super::agy_provider::detect_agy_active_family;
use super::super::civil::utc_ms;
use super::super::fake_deps::{home, now, FakeDeps};
use super::super::types::ModelFamily;
use super::*;

fn cached(doc: &serde_json::Value) -> Option<QuotaSnapshot> {
    parse_cached_usage(Some(&doc.to_string()), now())
}

#[test]
fn finds_no_cached_reading_in_missing_or_malformed_configs() {
    assert_eq!(parse_cached_usage(None, now()), None);
    assert_eq!(parse_cached_usage(Some("not json"), now()), None);
    assert_eq!(cached(&json!({})), None);
    assert_eq!(cached(&json!({ "cachedUsageUtilization": null })), None);
    // Windows without a numeric utilization are no reading at all.
    assert_eq!(
        cached(&json!({ "cachedUsageUtilization": { "utilization": {
            "five_hour": { "utilization": "high" },
            "seven_day": null,
        } } })),
        None
    );
}

#[test]
fn reads_a_cached_window_without_a_usable_reset_or_credit_limit() {
    let snapshot = cached(&json!({ "cachedUsageUtilization": {
        "utilization": null,
        "five_hour": { "utilization": 12.5, "resets_at": "" },
        "seven_day": { "utilization": 40, "resets_at": "soon" },
        "extra_usage": { "used_credits": 3 },
    } }))
    .expect("a cached reading");
    assert_eq!(
        snapshot
            .windows
            .iter()
            .map(|window| (window.kind, window.used_pct, window.resets_at))
            .collect::<Vec<_>>(),
        [
            (WindowKind::Session, 12.5, None),
            (WindowKind::Weekly, 40.0, None)
        ]
    );
    assert_eq!(
        (snapshot.fetched_at, snapshot.credits, snapshot.source),
        (now(), None, Some(QuotaSource::Cli))
    );
}

#[test]
fn takes_the_fetch_time_from_the_document_and_floors_the_credit_balance() {
    let fetched = utc_ms(2026, 9, 25, 2, 0);
    let snapshot = cached(&json!({
        "fetchedAtMs": fetched,
        "cachedUsageUtilization": {
            "fetchedAtMs": "not a number",
            "five_hour": { "utilization": 1, "resets_at": "2026-09-25T05:00:00Z" },
            "extra_usage": { "monthly_limit": 10, "used_credits": 25 },
        },
    }))
    .expect("a cached reading");
    assert_eq!(snapshot.fetched_at, fetched);
    assert_eq!(
        snapshot.windows[0].resets_at,
        Some(utc_ms(2026, 9, 25, 5, 0))
    );
    assert_eq!(
        snapshot.credits,
        Some(QuotaCredits {
            balance: Some(0.0),
            unlimited: false
        })
    );
}

#[test]
fn runs_in_a_trusted_project_only_when_the_config_names_one() {
    let fallback = Path::new("scratch");
    for config in [
        None,
        Some("{".to_string()),
        Some(json!({}).to_string()),
        Some(json!({ "projects": [] }).to_string()),
        Some(json!({ "projects": { "/a": { "hasTrustDialogAccepted": false } } }).to_string()),
    ] {
        assert_eq!(
            find_trusted_dir(config.as_deref(), fallback),
            PathBuf::from("scratch"),
            "{config:?}"
        );
    }
    let trusted = json!({ "projects": {
        "/a": {},
        "/b": { "hasTrustDialogAccepted": true },
    } })
    .to_string();
    assert_eq!(
        find_trusted_dir(Some(&trusted), fallback),
        PathBuf::from("/b")
    );
}

#[test]
fn skips_agy_settings_that_name_no_known_model() {
    let profile = home().join("agy-work");
    let unreadable = profile.join("antigravity-cli").join("settings.json");
    let unnamed = profile.join("settings.json");
    let numeric = home()
        .join(".gemini")
        .join("antigravity-cli")
        .join("settings.json");
    let named = home().join(".gemini").join("settings.json");
    let model = json!({ "model": "openai-gpt" }).to_string();
    let deps = FakeDeps::new(&[
        (unreadable, "{ not json"),
        (unnamed, "{\"theme\":\"dark\"}"),
        (numeric, "{\"model\":5}"),
        (named.clone(), model.as_str()),
    ]);
    assert_eq!(
        detect_agy_active_family(Some(&profile), &deps),
        Some(ModelFamily::Claude)
    );
    let unknown = json!({ "model": "llama" }).to_string();
    let deps = FakeDeps::new(&[(named, unknown.as_str())]);
    assert_eq!(detect_agy_active_family(None, &deps), None);
}
