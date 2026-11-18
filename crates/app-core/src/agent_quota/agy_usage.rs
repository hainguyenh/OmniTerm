//! Parse `agy -p /usage` (Antigravity CLI) output.
//!
//! Each line typically reads `<Model Group>  <Window Label>  <Percentage>%  <Reset Timestamp>`:
//!
//! ```text
//! Gemini Models          Weekly Limit Remaining     55%   2026-10-02T08:47:03Z
//! Gemini Models          Five Hour Limit Remaining  82%   2026-09-28T07:11:00Z
//! ```
//!
//! Port of the renderer's `agyUsageParser.ts`, which the inline pane probe still uses.

use super::claude_usage::{ParseFailure, UsageParse, PERCENT};
use super::iso_time::parse_iso;
use super::pattern::{chars, find, is_digit, is_space, string, test, Tok, MANY};
use super::reset::parse_reset_text;
use super::terminal_text::strip_terminal;
use super::types::{BreakdownEntry, ModelFamily, QuotaError, QuotaWindow, WindowKind};

const SPACES: Tok = Tok::Class(is_space, 1, MANY);

const NOT_SIGNED_IN: &[Tok] = &[Tok::Alt(&[
    &[
        Tok::Lit("please"),
        SPACES,
        Tok::Lit("run"),
        SPACES,
        Tok::Lit("/login"),
    ],
    &[
        Tok::Lit("not"),
        SPACES,
        Tok::Lit("logged"),
        SPACES,
        Tok::Lit("in"),
    ],
    &[Tok::Lit("login"), SPACES, Tok::Lit("required")],
    &[Tok::Lit("unauthorized")],
    &[
        Tok::Lit("invalid"),
        SPACES,
        Tok::Lit("api"),
        SPACES,
        Tok::Lit("key"),
    ],
    &[
        Tok::Lit("oauth"),
        SPACES,
        Tok::Lit("token"),
        SPACES,
        Tok::Lit("has"),
        SPACES,
        Tok::Lit("expired"),
    ],
    &[Tok::Lit("sign"), SPACES, Tok::Lit("in")],
])];

const fn digits(count: usize) -> Tok {
    Tok::Class(is_digit, count, count)
}

/// `\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\b`
const ISO_TIMESTAMP: &[Tok] = &[
    Tok::Boundary,
    Tok::Cap(
        0,
        &[
            digits(4),
            Tok::Lit("-"),
            digits(2),
            Tok::Lit("-"),
            digits(2),
            Tok::Lit("T"),
            digits(2),
            Tok::Lit(":"),
            digits(2),
            Tok::Lit(":"),
            digits(2),
            Tok::Opt(&[Tok::Lit("."), Tok::Class(is_digit, 1, MANY)]),
            Tok::Opt(&[Tok::Lit("Z")]),
        ],
    ),
    Tok::Boundary,
];

fn is_dash_or_space(c: char) -> bool {
    c == '-' || is_space(c)
}

const SUFFIX: &[Tok] = &[
    Tok::Opt(&[SPACES, Tok::Lit("limit")]),
    Tok::Opt(&[
        SPACES,
        Tok::Alt(&[
            &[Tok::Lit("remaining")],
            &[Tok::Lit("used")],
            &[Tok::Lit("left")],
        ]),
    ]),
    Tok::Boundary,
];

const SESSION: &[Tok] = &[
    Tok::Boundary,
    Tok::Alt(&[
        &[
            Tok::Lit("five"),
            Tok::Class(is_dash_or_space, 1, 1),
            Tok::Lit("hour"),
        ],
        &[
            Tok::Lit("5"),
            Tok::Opt(&[Tok::Class(is_dash_or_space, 1, 1)]),
            Tok::Lit("h"),
            Tok::Opt(&[Tok::Lit("ou")]),
            Tok::Opt(&[Tok::Lit("r")]),
        ],
        &[Tok::Lit("session")],
    ]),
    Tok::Alt(&[SUFFIX]),
];

const WEEKLY: &[Tok] = &[
    Tok::Boundary,
    Tok::Alt(&[
        &[Tok::Lit("week"), Tok::Opt(&[Tok::Lit("ly")])],
        &[
            Tok::Lit("7"),
            Tok::Opt(&[Tok::Class(is_dash_or_space, 1, 1)]),
            Tok::Lit("day"),
            Tok::Opt(&[Tok::Lit("s")]),
        ],
    ]),
    Tok::Alt(&[SUFFIX]),
];

const MONTHLY: &[Tok] = &[
    Tok::Boundary,
    Tok::Lit("month"),
    Tok::Opt(&[Tok::Lit("ly")]),
    Tok::Alt(&[SUFFIX]),
];

const USED_WORD: &[Tok] = &[Tok::Boundary, Tok::Lit("used"), Tok::Boundary];
const LEFT_WORD: &[Tok] = &[
    Tok::Boundary,
    Tok::Alt(&[&[Tok::Lit("remaining")], &[Tok::Lit("left")]]),
    Tok::Boundary,
];

fn not_line_end(c: char) -> bool {
    c != '\r' && c != '\n'
}

/// `(?:active\s+model|current\s+model|model\s+selection|model)\s*[:=]\s*([^\r\n]+)`
const MODEL_LINE: &[Tok] = &[
    Tok::Alt(&[
        &[Tok::Lit("active"), SPACES, Tok::Lit("model")],
        &[Tok::Lit("current"), SPACES, Tok::Lit("model")],
        &[Tok::Lit("model"), SPACES, Tok::Lit("selection")],
        &[Tok::Lit("model")],
    ]),
    Tok::Class(is_space, 0, MANY),
    Tok::Alt(&[&[Tok::Lit(":")], &[Tok::Lit("=")]]),
    Tok::Class(is_space, 0, MANY),
    Tok::Cap(0, &[Tok::Class(not_line_end, 1, MANY)]),
];

pub(crate) struct Reading {
    pub(crate) kind: WindowKind,
    pub(crate) model: String,
    pub(crate) used_pct: f64,
    pub(crate) resets_at: Option<i64>,
}

/// Remove terminal escapes and blank lines; trim what is left.
pub fn normalize_agy_text(raw: &str) -> Vec<String> {
    string(&strip_terminal(raw))
        .split('\n')
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

fn parse_reading(line: &str, now: i64) -> Option<Reading> {
    let subject = chars(line);
    let percent = find(PERCENT, &subject)?;
    let raw: f64 = percent
        .group(&subject, 0)?
        .replacen(',', ".", 1)
        .parse()
        .ok()?;
    if !raw.is_finite() || !(0.0..=100.0).contains(&raw) {
        return None;
    }
    let direction = percent
        .group(&subject, 1)
        .map(|word| word.to_ascii_lowercase());
    let explicitly_used =
        direction.as_deref() == Some("used") || (test(USED_WORD, line) && !test(LEFT_WORD, line));
    let used_pct = (if explicitly_used { raw } else { 100.0 - raw }).clamp(0.0, 100.0);

    let resets_at = match find(ISO_TIMESTAMP, &subject).and_then(|found| found.group(&subject, 0)) {
        Some(iso) => parse_iso(&iso).filter(|at| *at > 0),
        None => {
            let after = string(&subject[percent.end..]);
            let after = after.trim();
            if after.is_empty() {
                None
            } else {
                parse_reset_text(after, now)
            }
        }
    };

    let before = string(&subject[..percent.start]);
    let before = chars(before.trim());
    let (kind, at) = [
        (WindowKind::Session, SESSION),
        (WindowKind::Weekly, WEEKLY),
        (WindowKind::Monthly, MONTHLY),
    ]
    .into_iter()
    .find_map(|(kind, pattern)| find(pattern, &before).map(|found| (kind, found.start)))?;
    let model = string(&before[..at])
        .trim_end_matches(|c: char| is_space(c) || matches!(c, '-' | '\u{2013}' | '\u{2014}' | ':'))
        .trim()
        .to_string();
    let model = if model.is_empty() {
        "Default".to_string()
    } else {
        model
    };
    Some(Reading {
        kind,
        model,
        used_pct,
        resets_at,
    })
}

pub fn is_agy_model_match(model: &str, family: ModelFamily) -> bool {
    let lower = model.to_lowercase();
    let needles: &[&str] = match family {
        ModelFamily::Gemini => &["gemini", "google"],
        ModelFamily::Claude => &["claude", "gpt", "openai", "anthropic"],
    };
    needles.iter().any(|needle| lower.contains(needle))
}

fn family_of(model: &str) -> Option<ModelFamily> {
    [ModelFamily::Gemini, ModelFamily::Claude]
        .into_iter()
        .find(|family| is_agy_model_match(model, *family))
}

fn detect_family_from_text(raw: &str) -> Option<ModelFamily> {
    let subject = chars(raw);
    let found = find(MODEL_LINE, &subject)?;
    family_of(&found.group(&subject, 0)?)
}

fn label(kind: WindowKind) -> &'static str {
    match kind {
        WindowKind::Session => "Session (5h)",
        WindowKind::Weekly => "Weekly",
        WindowKind::Monthly => "Monthly",
    }
}

/// Parse the CLI output; `active` is the model family the profile runs, when known.
pub fn parse_agy_usage(raw: &str, now: i64, active: Option<ModelFamily>) -> UsageParse {
    if test(NOT_SIGNED_IN, raw) {
        return Err(ParseFailure::new(
            QuotaError::NotSignedIn,
            "Antigravity CLI is not signed in.",
        ));
    }
    let readings: Vec<Reading> = normalize_agy_text(raw)
        .iter()
        .filter_map(|line| parse_reading(line, now))
        .collect();
    if readings.is_empty() {
        return Err(ParseFailure::new(
            QuotaError::ParseFailed,
            "The /usage output named no quota windows.",
        ));
    }
    let preferred = active.or_else(|| detect_family_from_text(raw));
    Ok(pick_windows(&readings, preferred))
}

/// One window per kind from per-model readings: the preferred family's worst, the others as its
/// breakdown. Shared by the `/usage` parser and the status line bridge (agy_bridge.rs).
pub(crate) fn pick_windows(
    readings: &[Reading],
    preferred: Option<ModelFamily>,
) -> Vec<QuotaWindow> {
    let mut windows = Vec::new();
    for kind in WindowKind::ORDER {
        let matching: Vec<&Reading> = readings
            .iter()
            .filter(|reading| reading.kind == kind)
            .collect();
        if matching.is_empty() {
            continue;
        }
        let in_family = |family: ModelFamily| -> Vec<&Reading> {
            matching
                .iter()
                .copied()
                .filter(|reading| is_agy_model_match(&reading.model, family))
                .collect()
        };
        // The preferred family's worst reading; otherwise Gemini's (agy's default pool); otherwise
        // the worst overall.
        let by_family = preferred.map(in_family).unwrap_or_default();
        let candidates = if by_family.is_empty() {
            in_family(ModelFamily::Gemini)
        } else {
            by_family
        };
        let pool: &[&Reading] = if candidates.is_empty() {
            &matching
        } else {
            &candidates
        };
        let primary = pool[1..].iter().fold(pool[0], |top, reading| {
            if reading.used_pct > top.used_pct {
                *reading
            } else {
                top
            }
        });
        let breakdown = (matching.len() > 1).then(|| {
            matching
                .iter()
                .map(|reading| BreakdownEntry {
                    label: reading.model.clone(),
                    used_pct: reading.used_pct,
                })
                .collect()
        });
        windows.push(QuotaWindow {
            kind,
            used_pct: primary.used_pct,
            resets_at: primary.resets_at,
            label: label(kind).to_string(),
            breakdown,
        });
    }
    // Before its first use in a session window, agy reports only the weekly limit: the 5-hour
    // window is then untouched.
    let has = |kind: WindowKind| windows.iter().any(|window| window.kind == kind);
    if has(WindowKind::Weekly) && !has(WindowKind::Session) {
        windows.insert(
            0,
            QuotaWindow {
                kind: WindowKind::Session,
                used_pct: 0.0,
                resets_at: None,
                label: label(WindowKind::Session).to_string(),
                breakdown: None,
            },
        );
    }
    windows
}

#[cfg(test)]
#[path = "agy_usage_tests.rs"]
mod tests;
