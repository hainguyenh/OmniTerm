//! Codex usage from the `rate_limits` event Codex itself writes into its session log after every
//! model turn — the same numbers its `/status` shows, with no token and no request. Every turn on
//! this machine writes a new event, so the newest one is what this profile has spent here (a
//! floor: other devices on the account may add more). A window whose reset has passed since then
//! no longer says anything true and is dropped.

use std::io;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use super::deps::ProviderDeps;
use super::rate_windows::{
    as_number, as_record, normalize_rate_window, to_epoch_ms, worst_per_kind,
};
use super::types::{QuotaCredits, QuotaError, QuotaSnapshot, QuotaSource, QuotaWindow, WindowKind};

const TAIL_BYTES: u64 = 512 * 1024;

#[derive(Clone, Debug, PartialEq)]
pub struct RolloutReading {
    pub windows: Vec<QuotaWindow>,
    pub credits: Option<QuotaCredits>,
    pub at: i64,
}

fn present<'a>(record: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .find_map(|key| record.get(*key).filter(|value| !value.is_null()))
}

fn parse_credits(value: Option<&Value>) -> Option<QuotaCredits> {
    let credits = as_record(value?)?;
    if credits.get("has_credits") != Some(&Value::Bool(true)) {
        return None;
    }
    Some(QuotaCredits {
        balance: credits.get("balance").and_then(as_number),
        unlimited: credits.get("unlimited") == Some(&Value::Bool(true)),
    })
}

/// `rate_limits` as Codex writes it: `primary` (5 h) and `secondary` (7 d) plus `credits`.
pub fn parse_rate_limits(value: &Value) -> Option<(Vec<QuotaWindow>, Option<QuotaCredits>)> {
    let limits = as_record(value)?;
    let windows: Vec<QuotaWindow> = [
        normalize_rate_window(
            present(limits, &["primary", "primary_window"]),
            Some(WindowKind::Session),
        ),
        normalize_rate_window(
            present(limits, &["secondary", "secondary_window", "weekly_window"]),
            Some(WindowKind::Weekly),
        ),
        normalize_rate_window(
            present(limits, &["monthly_window", "month_window"]),
            Some(WindowKind::Monthly),
        ),
    ]
    .into_iter()
    .flatten()
    .collect();
    if windows.is_empty() {
        return None;
    }
    Some((
        worst_per_kind(windows),
        parse_credits(limits.get("credits")),
    ))
}

fn descending(deps: &dyn ProviderDeps, dir: &Path) -> io::Result<Vec<String>> {
    let mut names: Vec<String> = deps
        .list_dir(dir)?
        .into_iter()
        .filter(|name| !name.is_empty() && name.bytes().all(|b| b.is_ascii_digit()))
        .collect();
    names.sort();
    names.reverse();
    Ok(names)
}

fn newest_rollout(sessions: &Path, deps: &dyn ProviderDeps) -> io::Result<Option<PathBuf>> {
    for year in descending(deps, sessions)?.into_iter().take(2) {
        for month in descending(deps, &sessions.join(&year))?.into_iter().take(3) {
            for day in descending(deps, &sessions.join(&year).join(&month))?
                .into_iter()
                .take(7)
            {
                let day_dir = sessions.join(&year).join(&month).join(&day);
                let mut newest: Option<(PathBuf, i64)> = None;
                for name in deps.list_dir(&day_dir)? {
                    if !(name.starts_with("rollout-") && name.ends_with(".jsonl")) {
                        continue;
                    }
                    let file = day_dir.join(&name);
                    let mtime = deps.mtime(&file)?.unwrap_or(0);
                    if newest.as_ref().map_or(true, |(_, top)| mtime > *top) {
                        newest = Some((file, mtime));
                    }
                }
                if let Some((file, _)) = newest {
                    return Ok(Some(file));
                }
            }
        }
    }
    Ok(None)
}

/// The latest `rate_limits` Codex recorded after a model turn, read from the end of the newest rollout.
pub fn read_latest_rollout(
    codex_home: &Path,
    deps: &dyn ProviderDeps,
) -> io::Result<Option<RolloutReading>> {
    let Some(file) = newest_rollout(&codex_home.join("sessions"), deps)? else {
        return Ok(None);
    };
    let Some(tail) = deps.read_tail(&file, TAIL_BYTES) else {
        return Ok(None);
    };
    // The first line of a tail is usually cut mid-record; unparseable lines are skipped.
    let reading = tail
        .lines()
        .rev()
        .filter(|line| line.contains("\"rate_limits\""))
        .find_map(|line| {
            let event: Value = serde_json::from_str(line).ok()?;
            let (windows, credits) = parse_rate_limits(event.get("payload")?.get("rate_limits")?)?;
            let at = to_epoch_ms(event.get("timestamp"))?;
            Some(RolloutReading {
                windows,
                credits,
                at,
            })
        });
    Ok(reading)
}

pub fn fetch_codex_usage(
    profile_dir: Option<&Path>,
    deps: &dyn ProviderDeps,
) -> io::Result<QuotaSnapshot> {
    let now = deps.now();
    let home = profile_dir.map_or_else(|| deps.home().join(".codex"), Path::to_path_buf);
    let reading = read_latest_rollout(&home, deps)?;
    let Some(reading) = reading else {
        return Ok(QuotaSnapshot::failure(
            now,
            QuotaError::Unsupported,
            "Codex usage appears after its first reply.",
        ));
    };
    let windows: Vec<QuotaWindow> = reading
        .windows
        .into_iter()
        .filter(|window| window.resets_at.map_or(true, |at| at > now))
        .collect();
    if windows.is_empty() {
        return Ok(QuotaSnapshot::failure(
            now,
            QuotaError::Unsupported,
            "Codex usage appears after its first reply.",
        ));
    }
    let mut snapshot = QuotaSnapshot::reading(now, QuotaSource::Rollout, windows);
    snapshot.credits = reading.credits;
    Ok(snapshot)
}

#[cfg(test)]
#[path = "codex_rollout_tests.rs"]
mod tests;
