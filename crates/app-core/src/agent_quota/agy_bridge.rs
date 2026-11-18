//! The Antigravity status line bridge. The Antigravity CLI runs its `statusLine` command whenever
//! the agent's state changes and hands it, on stdin, a `quota` map: per bucket (`gemini-weekly`, …)
//! the `remaining_fraction` and `reset_time`. The bridge (OmniTerm run with
//! `--omniterm-agy-statusline`) keeps the last of them in
//! `<profile>/antigravity-cli/omniterm/agy-usage.json`, and the Antigravity provider reads that
//! record instead of running `agy -p /usage` while it is fresh.
//!
//! Like the Claude bridge, it is the CLI's own reading, written by a process the CLI started: no
//! token is read and no request is made. A record that is old, malformed or whose window has rolled
//! over is no reading at all, so the provider falls back to `agy -p /usage`.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use super::agy_usage::{is_agy_model_match, pick_windows, Reading};
use super::claude_bridge::{BRIDGE_DIR, MAX_AGE_MS};
use super::iso_time::parse_iso;
use super::types::{AgentKind, ModelFamily, QuotaSnapshot, QuotaSource, WindowKind};

/// The folder the Antigravity CLI keeps its own settings in, inside its home (`~/.gemini`).
const CLI_DIR: &str = "antigravity-cli";
const USAGE_FILE: &str = "agy-usage.json";
const FUTURE_SKEW_MS: i64 = 60 * 1000;

/// Where the CLI's `settings.json` (and the bridge's `omniterm` folder) live for a profile home.
pub(crate) fn agy_cli_dir(home: &Path) -> PathBuf {
    home.join(CLI_DIR)
}

pub(crate) fn agy_usage_file(home: &Path) -> PathBuf {
    agy_cli_dir(home).join(BRIDGE_DIR).join(USAGE_FILE)
}

/// The profile home a request names: its folder, or `~/.gemini` without one. A launcher without a
/// known folder sets its own, so there is no record to look for.
pub(crate) fn agy_home(
    profile_dir: Option<&Path>,
    launcher: Option<&str>,
    home: &Path,
) -> Option<PathBuf> {
    match (profile_dir, launcher) {
        (Some(dir), _) => Some(dir.to_path_buf()),
        (None, None) => Some(home.join(AgentKind::Agy.default_dir())),
        (None, Some(_)) => None,
    }
}

fn finite(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|n| n.is_finite())
}

/// The part of the status line input worth keeping: each bucket's used percentage and reset (Unix
/// ms). `None` when the input carries no bucket with a remaining fraction.
pub(crate) fn agy_usage_record(input: &Value, now_ms: i64) -> Option<Value> {
    let quota = input.get("quota")?.as_object()?;
    let mut buckets = Map::new();
    for (id, bucket) in quota {
        if bucket.get("disabled").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        // `remaining_amount` has no total to compare with, so only a fraction is a percentage.
        let Some(fraction) = finite(bucket.get("remaining_fraction")) else {
            continue;
        };
        let resets_at = bucket
            .get("reset_time")
            .and_then(Value::as_str)
            .and_then(parse_iso)
            .or_else(|| {
                finite(bucket.get("reset_in_seconds"))
                    .filter(|seconds| *seconds >= 0.0)
                    .map(|seconds| now_ms.saturating_add((seconds * 1000.0) as i64))
            });
        let used = ((1.0 - fraction) * 100.0).clamp(0.0, 100.0);
        buckets.insert(
            id.clone(),
            json!({ "used_percentage": used, "resets_at": resets_at }),
        );
    }
    let model = input
        .get("model")
        .and_then(|model| model.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    (!buckets.is_empty())
        .then(|| json!({ "version": 1, "writtenAt": now_ms, "model": model, "buckets": buckets }))
}

/// Which window a bucket ID names; `None` for a bucket that is no rolling limit.
fn bucket_kind(id: &str) -> Option<WindowKind> {
    let id = id.to_lowercase();
    if id.contains("week") {
        Some(WindowKind::Weekly)
    } else if id.contains("month") {
        Some(WindowKind::Monthly)
    } else if ["5h", "five", "hour", "session"]
        .iter()
        .any(|word| id.contains(word))
    {
        Some(WindowKind::Session)
    } else {
        None
    }
}

fn family_of(model: &str) -> Option<ModelFamily> {
    [ModelFamily::Gemini, ModelFamily::Claude]
        .into_iter()
        .find(|family| is_agy_model_match(model, *family))
}

/// A stored record as a reading, or `None` when it is stale, malformed or a window has reset since.
pub(crate) fn parse_agy_record(
    raw: &str,
    now: i64,
    family: Option<ModelFamily>,
) -> Option<QuotaSnapshot> {
    let doc: Value = serde_json::from_str(raw).ok()?;
    let written = doc.get("writtenAt").and_then(Value::as_i64)?;
    if now.saturating_sub(written) > MAX_AGE_MS || written > now.saturating_add(FUTURE_SKEW_MS) {
        return None;
    }
    let mut readings = Vec::new();
    for (id, bucket) in doc.get("buckets")?.as_object()? {
        let (Some(kind), Some(used)) = (bucket_kind(id), finite(bucket.get("used_percentage")))
        else {
            continue;
        };
        let resets_at = bucket
            .get("resets_at")
            .and_then(Value::as_i64)
            .filter(|at| *at > 0);
        // The window rolled over after the record was written: its percentage no longer applies.
        if resets_at.is_some_and(|at| at <= now) {
            return None;
        }
        readings.push(Reading {
            kind,
            model: id.clone(),
            used_pct: used.clamp(0.0, 100.0),
            resets_at,
        });
    }
    if readings.is_empty() {
        return None;
    }
    let model = doc.get("model").and_then(Value::as_str).unwrap_or_default();
    let windows = pick_windows(&readings, family.or_else(|| family_of(model)));
    Some(QuotaSnapshot::reading(
        written,
        QuotaSource::Statusline,
        windows,
    ))
}

/// `Quota 5h 18% · wk 6%`: the line the bridge prints when no earlier status line is chained.
pub(crate) fn agy_status_text(record: Option<&Value>, now: i64) -> String {
    let snapshot = record.and_then(|record| parse_agy_record(&record.to_string(), now, None));
    let Some(snapshot) = snapshot else {
        return "Quota: waiting for Antigravity".to_string();
    };
    let parts: Vec<String> = snapshot
        .windows
        .iter()
        .map(|window| {
            let name = match window.kind {
                WindowKind::Session => "5h",
                WindowKind::Weekly => "wk",
                WindowKind::Monthly => "mo",
            };
            format!("{name} {:.0}%", window.used_pct)
        })
        .collect();
    format!("Quota {}", parts.join(" · "))
}

#[cfg(test)]
#[path = "agy_bridge_tests.rs"]
mod tests;
