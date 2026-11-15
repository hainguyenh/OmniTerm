//! JSON helpers for provider payloads, which are external data and validated field by field.

use serde_json::{Map, Value};

use super::iso_time::parse_iso;
use super::types::{QuotaWindow, WindowKind};

pub(crate) fn as_record(value: &Value) -> Option<&Map<String, Value>> {
    value.as_object()
}

/// A finite number, or a non-blank string holding one.
pub(crate) fn as_number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64().filter(|n| n.is_finite()),
        Value::String(text) if !text.trim().is_empty() => {
            text.trim().parse::<f64>().ok().filter(|n| n.is_finite())
        }
        _ => None,
    }
}

pub(crate) fn first_number(record: &Map<String, Value>, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|key| record.get(*key).and_then(as_number))
}

const HOUR: f64 = 3600.0;
const DAY: f64 = 24.0 * HOUR;

/// Name a window by its length: 4–6 h is the session, 6–8 d the week, 27–32 d the month.
pub(crate) fn classify_window_seconds(seconds: Option<f64>) -> Option<WindowKind> {
    let seconds = seconds.filter(|s| *s > 0.0)?;
    if (4.0 * HOUR..=6.0 * HOUR).contains(&seconds) {
        Some(WindowKind::Session)
    } else if (6.0 * DAY..=8.0 * DAY).contains(&seconds) {
        Some(WindowKind::Weekly)
    } else if (27.0 * DAY..=32.0 * DAY).contains(&seconds) {
        Some(WindowKind::Monthly)
    } else {
        None
    }
}

/// Epoch seconds or milliseconds, or an ISO string, as epoch milliseconds.
pub(crate) fn to_epoch_ms(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    if let Some(numeric) = as_number(value) {
        let ms = if numeric > 1e12 {
            numeric
        } else {
            numeric * 1000.0
        };
        return Some(ms.round() as i64);
    }
    value.as_str().and_then(|text| parse_iso(text.trim()))
}

pub(crate) fn clamp_pct(value: f64) -> f64 {
    value.clamp(0.0, 100.0)
}

fn label(kind: WindowKind) -> &'static str {
    match kind {
        WindowKind::Session => "5-hour session",
        WindowKind::Weekly => "Weekly",
        WindowKind::Monthly => "Monthly",
    }
}

/// Normalise a Codex-style window (`used_percent`, `reset_at`/`resets_at`, `limit_window_seconds`
/// or `window_minutes`). `fallback` names the window when its length is missing: the first window
/// a provider reports is the session, the second the week.
pub(crate) fn normalize_rate_window(
    value: Option<&Value>,
    fallback: Option<WindowKind>,
) -> Option<QuotaWindow> {
    let source = as_record(value?)?;
    let used_pct = first_number(source, &["used_percent", "usedPercent", "usage_percent"])?;
    let seconds = first_number(
        source,
        &["limit_window_seconds", "window_seconds", "windowSeconds"],
    )
    .or_else(|| {
        first_number(source, &["window_minutes", "windowMinutes"]).map(|minutes| minutes * 60.0)
    });
    let kind = classify_window_seconds(seconds).or(fallback)?;
    let reset = ["reset_at", "resets_at", "resetAt", "resetsAt"]
        .iter()
        .find_map(|key| source.get(*key).filter(|v| !v.is_null()));
    Some(QuotaWindow {
        kind,
        used_pct: clamp_pct(used_pct),
        resets_at: to_epoch_ms(reset),
        label: label(kind).to_string(),
        breakdown: None,
    })
}

/// Keep one window per kind — the fullest, since that one runs out first.
pub(crate) fn worst_per_kind(windows: Vec<QuotaWindow>) -> Vec<QuotaWindow> {
    WindowKind::ORDER
        .iter()
        .filter_map(|kind| {
            windows.iter().filter(|window| window.kind == *kind).fold(
                None::<&QuotaWindow>,
                |top, window| match top {
                    Some(top) if window.used_pct <= top.used_pct => Some(top),
                    _ => Some(window),
                },
            )
        })
        .cloned()
        .collect()
}

#[cfg(test)]
#[path = "rate_windows_tests.rs"]
mod tests;
