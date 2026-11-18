//! The Claude status line bridge: Claude Code hands its status line command the profile's
//! `rate_limits` after every reply. The bridge command (OmniTerm run with
//! `--omniterm-claude-statusline`) keeps the last of them in `<profile>/omniterm/claude-usage.json`;
//! the Claude provider reads that record instead of running `claude -p /usage` while it is fresh,
//! and the `PreToolUse` guard reads it to refuse a new sub-agent once a limit is reached.
//!
//! The record is the CLI's own reading, written by a process Claude Code started: no token is read
//! and no request is made. A record that is old, malformed, or whose window has rolled over since is
//! no reading at all, so the provider falls back to the CLI and the guard lets the tool run.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use super::types::{QuotaSnapshot, QuotaSource, QuotaWindow, WindowKind};

/// The folder OmniTerm keeps its bridge files in, inside a Claude profile directory.
pub(crate) const BRIDGE_DIR: &str = "omniterm";
const USAGE_FILE: &str = "claude-usage.json";
const BRIDGE_FILE: &str = "bridge.json";
/// A record older than this is not trusted: no Claude session of the profile has replied since, and
/// another device may have used the account meanwhile.
pub(crate) const MAX_AGE_MS: i64 = 10 * 60 * 1000;
/// Clock skew tolerated for a record written "in the future".
const FUTURE_SKEW_MS: i64 = 60 * 1000;

const WINDOWS: [(&str, WindowKind, &str); 2] = [
    ("five_hour", WindowKind::Session, "5-hour limit"),
    ("seven_day", WindowKind::Weekly, "Weekly limit"),
];

pub(crate) fn usage_file(profile_dir: &Path) -> PathBuf {
    profile_dir.join(BRIDGE_DIR).join(USAGE_FILE)
}

pub(crate) fn bridge_file(profile_dir: &Path) -> PathBuf {
    profile_dir.join(BRIDGE_DIR).join(BRIDGE_FILE)
}

/// The part of the status line input worth keeping: each window's used percentage and reset (Unix
/// seconds, as Claude Code sends it). `None` when the input carries no usable window — before the
/// first reply of a session, or on a plan without rate limits.
pub(crate) fn usage_record(input: &Value, now_ms: i64) -> Option<Value> {
    let limits = input.get("rate_limits")?;
    let mut windows = Map::new();
    for (key, _, _) in WINDOWS {
        let Some(window) = limits.get(key) else {
            continue;
        };
        let Some(used) = window.get("used_percentage").and_then(Value::as_f64) else {
            continue;
        };
        let resets_at = window.get("resets_at").and_then(Value::as_f64);
        windows.insert(
            key.to_string(),
            json!({ "used_percentage": used, "resets_at": resets_at }),
        );
    }
    (!windows.is_empty())
        .then(|| json!({ "version": 1, "writtenAt": now_ms, "rateLimits": windows }))
}

/// A stored record as a reading, or `None` when it is stale, malformed or a window has reset since.
pub(crate) fn parse_usage_record(raw: &str, now: i64) -> Option<QuotaSnapshot> {
    let doc: Value = serde_json::from_str(raw).ok()?;
    let written = doc.get("writtenAt").and_then(Value::as_i64)?;
    if now.saturating_sub(written) > MAX_AGE_MS || written > now.saturating_add(FUTURE_SKEW_MS) {
        return None;
    }
    let limits = doc.get("rateLimits")?;
    let mut windows = Vec::new();
    for (key, kind, label) in WINDOWS {
        let Some(window) = limits.get(key) else {
            continue;
        };
        let Some(used) = window
            .get("used_percentage")
            .and_then(Value::as_f64)
            .filter(|used| used.is_finite())
        else {
            continue;
        };
        let resets_at = window
            .get("resets_at")
            .and_then(Value::as_f64)
            .filter(|seconds| seconds.is_finite() && *seconds > 0.0)
            .map(|seconds| (seconds * 1000.0) as i64);
        // The window rolled over after the record was written: its percentage no longer applies.
        if resets_at.is_some_and(|at| at <= now) {
            return None;
        }
        windows.push(QuotaWindow {
            kind,
            used_pct: used.clamp(0.0, 100.0),
            resets_at,
            label: label.to_string(),
            breakdown: None,
        });
    }
    (!windows.is_empty()).then(|| QuotaSnapshot::reading(written, QuotaSource::Statusline, windows))
}

/// `5h 42% · 7d 13%`: the line the bridge prints when no earlier status line is chained.
pub(crate) fn status_text(record: Option<&Value>) -> String {
    let Some(limits) = record.and_then(|record| record.get("rateLimits")) else {
        return "Claude quota: waiting for the first reply".to_string();
    };
    WINDOWS
        .iter()
        .filter_map(|(key, kind, _)| {
            let used = limits.get(*key)?.get("used_percentage")?.as_f64()?;
            let name = if *kind == WindowKind::Session {
                "5h"
            } else {
                "7d"
            };
            Some(format!("{name} {used:.0}%"))
        })
        .collect::<Vec<_>>()
        .join(" · ")
}

/// The limits the guard enforces, taken from OmniTerm's own Agent Quota settings.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct GuardLimits {
    pub session: f64,
    pub weekly: f64,
}

const DEFAULT_LIMITS: GuardLimits = GuardLimits {
    session: 90.0,
    weekly: 95.0,
};

fn flag(value: Option<&Value>, fallback: bool) -> bool {
    value.and_then(Value::as_bool).unwrap_or(fallback)
}

fn limit(value: Option<&Value>, fallback: f64) -> f64 {
    value
        .and_then(Value::as_f64)
        .filter(|pct| pct.is_finite())
        .map_or(fallback, |pct| pct.round().clamp(5.0, 100.0))
}

/// The Claude limits from OmniTerm's settings file, or `None` when the guard must not block: Agent
/// Quota is off, Claude is not monitored, or the user turned "suspend at limit" off (they chose to
/// keep working past it). A missing or unreadable file keeps the defaults the app itself uses.
pub(crate) fn guard_limits(app_settings: Option<&str>) -> Option<GuardLimits> {
    let doc = app_settings
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
        .unwrap_or(Value::Null);
    let quota = doc.get("agentQuota");
    let claude = quota.and_then(|quota| quota.get("agents")?.get("claude"));
    let on = flag(quota.and_then(|quota| quota.get("enabled")), true)
        && flag(claude.and_then(|claude| claude.get("enabled")), true)
        && flag(claude.and_then(|claude| claude.get("suspendAtLimit")), true);
    if !on {
        return None;
    }
    let limits = claude.and_then(|claude| claude.get("limits"));
    Some(GuardLimits {
        session: limit(
            limits.and_then(|limits| limits.get("session")),
            DEFAULT_LIMITS.session,
        ),
        weekly: limit(
            limits.and_then(|limits| limits.get("weekly")),
            DEFAULT_LIMITS.weekly,
        ),
    })
}

/// Why a new sub-agent must not start, when a window has reached its limit.
pub(crate) fn blocked_reason(snapshot: &QuotaSnapshot, limits: GuardLimits) -> Option<String> {
    snapshot.windows.iter().find_map(|window| {
        let (name, limit) = match window.kind {
            WindowKind::Session => ("5-hour", limits.session),
            WindowKind::Weekly => ("weekly", limits.weekly),
            WindowKind::Monthly => return None,
        };
        (window.used_pct >= limit).then(|| {
            format!(
                "OmniTerm Agent Quota: the Claude {name} quota is at {used:.0}% (limit {limit:.0}%), \
                 so starting another sub-agent is blocked. Finish the task in this session without \
                 sub-agents, or wait for the quota to reset.",
                used = window.used_pct,
            )
        })
    })
}

#[cfg(test)]
#[path = "claude_bridge_tests.rs"]
mod tests;
