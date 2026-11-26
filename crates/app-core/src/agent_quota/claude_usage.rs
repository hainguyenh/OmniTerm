//! Parse `claude -p /usage` output.
//!
//! The CLI's wording has drifted between releases and the same run mixes quota lines with prose
//! that also contains percentages ("59% of your usage was at >150k context"). So a value is only
//! taken from a line that *starts* with a known window label, and everything else is ignored.
//! When the label and the number sit on neighbouring lines (the bar layout of the interactive
//! panel), the next two lines are searched too, stopping at the next label.
//!
//! A reply that names no quota window at all — for example a model answer, when an argument got
//! mangled into a prompt — is `parse_failed`, never zero usage. Port of the renderer's
//! `claudeUsageParser.ts`, which the inline pane probe (and its Codex `/status` reshaping) still
//! uses; both must agree.

use super::pattern::{chars, find, is_digit, is_space, match_at, string, test, Tok, MANY};
use super::reset::parse_reset_text;
use super::terminal_text::strip_terminal;
use super::types::{BreakdownEntry, QuotaError, QuotaWindow, WindowKind};

/// Why a CLI output yielded no windows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParseFailure {
    pub error: QuotaError,
    pub message: String,
}

impl ParseFailure {
    pub(crate) fn new(error: QuotaError, message: &str) -> Self {
        Self {
            error,
            message: message.to_string(),
        }
    }
}

pub type UsageParse = Result<Vec<QuotaWindow>, ParseFailure>;

fn is_dash_or_space(c: char) -> bool {
    c == '-' || is_space(c)
}

fn not_close(c: char) -> bool {
    c != ')'
}

const PARENS: &[Tok] = &[
    Tok::Class(is_space, 0, MANY),
    Tok::Lit("("),
    Tok::Class(not_close, 0, MANY),
    Tok::Lit(")"),
];
const SPACES: Tok = Tok::Class(is_space, 1, MANY);
const LIMIT: &[Tok] = &[SPACES, Tok::Lit("limit")];

const SESSION_LABEL: &[Tok] = &[
    Tok::Start,
    Tok::Alt(&[
        &[Tok::Lit("current"), SPACES, Tok::Lit("session")],
        &[
            Tok::Lit("5"),
            Tok::Opt(&[Tok::Class(is_dash_or_space, 1, 1)]),
            Tok::Lit("h"),
            Tok::Opt(&[Tok::Lit("ou")]),
            Tok::Opt(&[Tok::Lit("r")]),
            Tok::Opt(&[Tok::Lit("s")]),
            Tok::Opt(&[
                SPACES,
                Tok::Alt(&[
                    &[Tok::Lit("limit")],
                    &[Tok::Lit("window")],
                    &[Tok::Lit("session")],
                ]),
            ]),
        ],
        &[Tok::Lit("session")],
    ]),
    Tok::Boundary,
    Tok::Opt(PARENS),
];

const WEEKLY_LABEL: &[Tok] = &[
    Tok::Start,
    Tok::Alt(&[
        &[Tok::Lit("current"), SPACES, Tok::Lit("week")],
        &[Tok::Lit("weekly"), Tok::Opt(LIMIT)],
        &[Tok::Lit("week")],
        &[
            Tok::Lit("7"),
            Tok::Opt(&[Tok::Class(is_dash_or_space, 1, 1)]),
            Tok::Lit("day"),
            Tok::Opt(&[Tok::Lit("s")]),
            Tok::Opt(LIMIT),
        ],
    ]),
    Tok::Boundary,
    Tok::Opt(PARENS),
];

const MONTHLY_LABEL: &[Tok] = &[
    Tok::Start,
    Tok::Alt(&[
        &[Tok::Lit("current"), SPACES, Tok::Lit("month")],
        &[Tok::Lit("monthly"), Tok::Opt(LIMIT)],
    ]),
    Tok::Boundary,
    Tok::Opt(PARENS),
];

const LABELS: [(WindowKind, &[Tok]); 3] = [
    (WindowKind::Session, SESSION_LABEL),
    (WindowKind::Weekly, WEEKLY_LABEL),
    (WindowKind::Monthly, MONTHLY_LABEL),
];

fn is_decimal_mark(c: char) -> bool {
    c == '.' || c == ','
}

/// `(\d{1,3}(?:[.,]\d+)?)\s*%\s*(used|left|remaining)?`
pub(crate) const PERCENT: &[Tok] = &[
    Tok::Cap(
        0,
        &[
            Tok::Class(is_digit, 1, 3),
            Tok::Opt(&[
                Tok::Class(is_decimal_mark, 1, 1),
                Tok::Class(is_digit, 1, MANY),
            ]),
        ],
    ),
    Tok::Class(is_space, 0, MANY),
    Tok::Lit("%"),
    Tok::Class(is_space, 0, MANY),
    Tok::Opt(&[Tok::Cap(
        1,
        &[Tok::Alt(&[
            &[Tok::Lit("used")],
            &[Tok::Lit("left")],
            &[Tok::Lit("remaining")],
        ])],
    )]),
];

fn any_char(_: char) -> bool {
    true
}

/// `\bresets?\b\s*(.+)$`
const RESET: &[Tok] = &[
    Tok::Boundary,
    Tok::Lit("reset"),
    Tok::Opt(&[Tok::Lit("s")]),
    Tok::Boundary,
    Tok::Class(is_space, 0, MANY),
    Tok::Cap(0, &[Tok::Class(any_char, 1, MANY)]),
    Tok::End,
];

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
])];

const MAX_RESET_AHEAD_MS: i64 = 8 * 86_400_000;

fn is_glyph(c: char) -> bool {
    ('\u{2500}'..='\u{259f}').contains(&c)
        || ('\u{25a0}'..='\u{25ff}').contains(&c)
        || ('\u{2800}'..='\u{28ff}').contains(&c)
}

fn is_marker(c: char) -> bool {
    is_space(c)
        || matches!(
            c,
            '>' | '*' | '-' | '\u{2013}' | '\u{2014}' | ':' | '\u{b7}'
        )
}

/// Remove terminal escapes, bar glyphs and odd separators so labels start their lines.
pub fn normalize_usage_text(raw: &str) -> Vec<String> {
    let mut text = String::new();
    for c in strip_terminal(raw) {
        match c {
            c if is_glyph(c) => text.push(' '),
            '\u{b7}' | '\u{2022}' | '|' => text.push_str(" \u{b7} "),
            c => text.push(c),
        }
    }
    text.split('\n')
        .map(|line| {
            let mut collapsed = String::with_capacity(line.len());
            let mut in_space = false;
            for c in line.chars() {
                if is_space(c) {
                    if !in_space {
                        collapsed.push(' ');
                    }
                    in_space = true;
                } else {
                    collapsed.push(c);
                    in_space = false;
                }
            }
            collapsed.trim_start_matches(is_marker).trim().to_string()
        })
        .collect()
}

struct Label {
    kind: WindowKind,
    label: String,
    rest: String,
}

fn match_label(line: &str) -> Option<Label> {
    let subject = chars(line);
    for (kind, pattern) in LABELS {
        let Some(found) = match_at(pattern, &subject, 0) else {
            continue;
        };
        let rest = string(&subject[found.end..]);
        // "Session history" or "Weekly digest" prose has no colon and no percentage. A label alone
        // on its line is the bar layout; its value must then come from the lines below.
        if !rest.trim().is_empty() && !rest.trim_start().starts_with(':') && !test(PERCENT, &rest) {
            continue;
        }
        let label = string(&subject[..found.end])
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        return Some(Label { kind, label, rest });
    }
    None
}

fn read_percent(text: &str, needs_direction: bool) -> Option<f64> {
    let subject = chars(text);
    let found = find(PERCENT, &subject)?;
    let direction = found
        .group(&subject, 1)
        .map(|word| word.to_ascii_lowercase());
    if needs_direction && direction.is_none() {
        return None;
    }
    let value: f64 = found
        .group(&subject, 0)?
        .replacen(',', ".", 1)
        .parse()
        .ok()?;
    if !value.is_finite() || !(0.0..=100.0).contains(&value) {
        return None;
    }
    Some(
        if matches!(direction.as_deref(), Some("left" | "remaining")) {
            100.0 - value
        } else {
            value
        },
    )
}

fn read_window(lines: &[String], index: usize, now: i64) -> Option<QuotaWindow> {
    let head = match_label(&lines[index])?;
    let mut scope = vec![head.rest.clone()];
    for next in lines.iter().skip(index + 1).take(2) {
        if next.is_empty() || match_label(next).is_some() {
            break;
        }
        scope.push(next.clone());
    }
    let mut used_pct = None;
    let mut resets_at = None;
    // A value below the label must say "used", "left" or "remaining": a bare percentage there is
    // more likely prose ("59% of your usage was at >150k context") than the window's reading.
    for (position, text) in scope.iter().enumerate() {
        if used_pct.is_none() {
            used_pct = read_percent(text, position > 0);
        }
        let subject = chars(text);
        if resets_at.is_none() {
            if let Some(reset) = find(RESET, &subject).and_then(|found| found.group(&subject, 0)) {
                resets_at = parse_reset_text(&reset, now);
            }
        }
    }
    let label = head
        .label
        .trim_end_matches(|c: char| c == ':' || is_space(c))
        .to_string();
    Some(QuotaWindow {
        kind: head.kind,
        used_pct: used_pct?,
        resets_at,
        label,
        breakdown: None,
    })
}

/// Parse the CLI output. `now` is injected so reset dates are deterministic in tests.
pub fn parse_claude_usage(raw: &str, now: i64) -> UsageParse {
    if test(NOT_SIGNED_IN, raw) {
        return Err(ParseFailure::new(
            QuotaError::NotSignedIn,
            "Claude Code is not signed in for this profile.",
        ));
    }
    let lines = normalize_usage_text(raw);
    let readings: Vec<QuotaWindow> = (0..lines.len())
        .filter_map(|index| read_window(&lines, index, now))
        .map(|mut reading| {
            if reading
                .resets_at
                .is_some_and(|at| at > now + MAX_RESET_AHEAD_MS)
            {
                reading.resets_at = None;
            }
            reading
        })
        .collect();
    let by_kind = |kind: WindowKind| readings.iter().filter(move |reading| reading.kind == kind);
    // A pane screen can hold several panels; the last one drawn is the freshest.
    let Some(session) = by_kind(WindowKind::Session).next_back() else {
        return Err(ParseFailure::new(
            QuotaError::ParseFailed,
            "The /usage output named no session window.",
        ));
    };
    let mut windows = vec![session.clone()];
    // Weekly may be split per model ("all models", "Opus", "Sonnet"): the highest one is what runs
    // out first, so it drives the limit, and the rest ride along for the tooltip.
    let weekly: Vec<&QuotaWindow> = by_kind(WindowKind::Weekly).collect();
    if let Some(first) = weekly.first() {
        let worst = weekly.iter().fold(*first, |top, reading| {
            if reading.used_pct > top.used_pct {
                reading
            } else {
                top
            }
        });
        let mut window = worst.clone();
        if weekly.len() > 1 {
            window.breakdown = Some(
                weekly
                    .iter()
                    .map(|reading| BreakdownEntry {
                        label: reading.label.clone(),
                        used_pct: reading.used_pct,
                    })
                    .collect(),
            );
        }
        windows.push(window);
    }
    if let Some(monthly) = by_kind(WindowKind::Monthly).next() {
        windows.push(monthly.clone());
    }
    Ok(windows)
}

#[cfg(test)]
#[path = "claude_usage_tests.rs"]
mod tests;
