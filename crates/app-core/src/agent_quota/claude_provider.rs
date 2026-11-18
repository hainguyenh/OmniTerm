//! Claude usage, first from the record the OmniTerm status line bridge keeps while a Claude session
//! of the profile replies (see claude_bridge.rs), else from the CLI's own `/usage` command, run
//! exactly as the user runs the profile: through its launcher (`claude-th -p /usage`) when the
//! terminal used one, otherwise `claude` with the profile's `CLAUDE_CONFIG_DIR`. The CLI does its own sign-in; this reads no token and makes no
//! request of its own. Output that cannot be read is retried once and then reported as
//! `parse_failed` — never as zero usage — unless the profile config holds the reading Claude Code
//! cached last.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;

use super::claude_bridge::{parse_usage_record, usage_file};
use super::claude_usage::parse_claude_usage;
use super::deps::{CliOptions, ProviderDeps};
use super::iso_time::parse_iso;
use super::launcher::agent_command;
use super::pattern::{is_word, replace_all, Tok, MANY};
use super::types::{
    AgentKind, QuotaCredits, QuotaError, QuotaSnapshot, QuotaSource, QuotaWindow, WindowKind,
};

const USAGE_TIMEOUT: Duration = Duration::from_secs(8);
const CONFIG_TAIL: u64 = 1_000_000;
const BRIDGE_TAIL: u64 = 64 * 1024;

fn is_email_local(c: char) -> bool {
    is_word(c) || matches!(c, '.' | '+' | '-')
}

fn is_word_or_dash(c: char) -> bool {
    is_word(c) || c == '-'
}

fn is_domain(c: char) -> bool {
    is_word(c) || matches!(c, '.' | '-')
}

const EMAIL: &[Tok] = &[
    Tok::Class(is_email_local, 1, MANY),
    Tok::Lit("@"),
    Tok::Class(is_word_or_dash, 1, MANY),
    Tok::Lit("."),
    Tok::Class(is_domain, 1, MANY),
];

const TOKEN: &[Tok] = &[
    Tok::Boundary,
    Tok::Alt(&[
        &[Tok::Lit("sk-"), Tok::Class(is_word_or_dash, 8, MANY)],
        &[Tok::Class(is_word_or_dash, 32, MANY)],
    ]),
    Tok::Boundary,
];

/// Trim a sample of unrecognised output for the diagnostics log, masking anything token-shaped.
pub fn redact_sample(text: &str) -> String {
    let head: String = text.chars().take(1024).collect();
    let masked = replace_all(EMAIL, &head, &|_, _| "<email>".to_string());
    replace_all(TOKEN, &masked, &|_, _| "<redacted>".to_string())
}

fn reset_of(window: &Value) -> Option<i64> {
    window
        .get("resets_at")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .and_then(parse_iso)
        .filter(|at| *at != 0)
}

/// The reading Claude Code caches in the profile config, nested under `utilization` as it writes it.
pub(crate) fn parse_cached_usage(raw: Option<&str>, now: i64) -> Option<QuotaSnapshot> {
    let doc: Value = serde_json::from_str(raw?).ok()?;
    let cached = doc
        .get("cachedUsageUtilization")
        .filter(|value| !value.is_null())?;
    let usage = cached
        .get("utilization")
        .filter(|value| !value.is_null())
        .unwrap_or(cached);
    let mut windows = Vec::new();
    let mut push = |key: &str, kind: WindowKind, label: &str| {
        let Some(window) = usage.get(key) else { return };
        if let Some(used_pct) = window.get("utilization").and_then(Value::as_f64) {
            windows.push(QuotaWindow {
                kind,
                used_pct,
                resets_at: reset_of(window),
                label: label.to_string(),
                breakdown: None,
            });
        }
    };
    push("five_hour", WindowKind::Session, "5-hour limit");
    push("seven_day", WindowKind::Weekly, "Weekly limit");
    if windows.is_empty() {
        return None;
    }
    let credits = usage.get("extra_usage").and_then(|extra| {
        let limit = extra.get("monthly_limit").and_then(Value::as_f64)?;
        let used = extra
            .get("used_credits")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        Some(QuotaCredits {
            balance: Some((limit - used).max(0.0)),
            unlimited: false,
        })
    });
    let fetched_at = [cached.get("fetchedAtMs"), doc.get("fetchedAtMs")]
        .into_iter()
        .flatten()
        .find_map(Value::as_f64)
        .map_or(now, |at| at as i64);
    let mut snapshot = QuotaSnapshot::reading(fetched_at, QuotaSource::Cli, windows);
    snapshot.credits = credits;
    Some(snapshot)
}

/// A folder the profile has already trusted, so `claude -p` shows no trust prompt there.
pub(crate) fn find_trusted_dir(raw: Option<&str>, fallback: &Path) -> PathBuf {
    raw.and_then(|text| serde_json::from_str::<Value>(text).ok())
        .and_then(|doc| {
            doc.get("projects")?
                .as_object()?
                .iter()
                .find_map(|(dir, project)| {
                    (project
                        .get("hasTrustDialogAccepted")
                        .and_then(Value::as_bool)
                        == Some(true))
                    .then(|| PathBuf::from(dir))
                })
        })
        .unwrap_or_else(|| fallback.to_path_buf())
}

/// The status line bridge's fresh record for the profile. A launcher without a known directory
/// sets its own, so there is no record to look for.
fn bridge_reading(
    profile_dir: Option<&Path>,
    launcher: Option<&str>,
    deps: &dyn ProviderDeps,
) -> Option<QuotaSnapshot> {
    let dir = match (profile_dir, launcher) {
        (Some(dir), _) => dir.to_path_buf(),
        (None, None) => deps.home().join(AgentKind::Claude.default_dir()),
        (None, Some(_)) => return None,
    };
    parse_usage_record(&deps.read_tail(&usage_file(&dir), BRIDGE_TAIL)?, deps.now())
}

pub fn fetch_claude_usage(
    profile_dir: Option<&Path>,
    launcher: Option<&str>,
    deps: &dyn ProviderDeps,
) -> QuotaSnapshot {
    if let Some(reading) = bridge_reading(profile_dir, launcher, deps) {
        return reading;
    }
    let Some(command) = agent_command(AgentKind::Claude, profile_dir, launcher, deps) else {
        return QuotaSnapshot::failure(
            deps.now(),
            QuotaError::Unsupported,
            "Claude Code CLI not found.",
        );
    };
    let home_config = deps.home().join(".claude.json");
    let config = match profile_dir {
        Some(dir) => deps
            .read_tail(&dir.join(".claude.json"), CONFIG_TAIL)
            .or_else(|| deps.read_tail(&home_config, CONFIG_TAIL)),
        None => deps.read_tail(&home_config, CONFIG_TAIL),
    };
    let cwd = find_trusted_dir(config.as_deref(), deps.tmp());
    let options = CliOptions {
        env: command.env,
        timeout: USAGE_TIMEOUT,
        cwd: Some(cwd),
    };
    let args = ["-p".to_string(), "/usage".to_string()];

    let mut last =
        QuotaSnapshot::failure(deps.now(), QuotaError::Failed, "claude /usage did not run.");
    for attempt in 0..2 {
        let result = deps.run(&command.exe, &args, &options);
        let now = deps.now();
        if result.timed_out {
            last = QuotaSnapshot::failure(now, QuotaError::Timeout, "claude /usage timed out.");
            break;
        }
        let output = format!("{}\n{}", result.stdout, result.stderr);
        match parse_claude_usage(&output, now) {
            Ok(windows) => return QuotaSnapshot::reading(now, QuotaSource::Cli, windows),
            Err(failure) => {
                last = QuotaSnapshot::failure(now, failure.error, failure.message);
                if failure.error == QuotaError::NotSignedIn {
                    return last;
                }
                if attempt == 1 {
                    deps.log(&format!(
                        "[agent-quota] unrecognised claude /usage output: {}",
                        redact_sample(&output)
                    ));
                }
            }
        }
    }
    parse_cached_usage(config.as_deref(), deps.now()).unwrap_or(last)
}

#[cfg(test)]
#[path = "providers_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "provider_config_tests.rs"]
mod config_tests;

#[cfg(test)]
#[path = "claude_provider_bridge_tests.rs"]
mod bridge_tests;
