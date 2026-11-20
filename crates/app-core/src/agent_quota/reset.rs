//! Reset times as agents print them, turned into epoch milliseconds.
//!
//! Claude prints wall-clock times in the account's zone — `Sep 25, 12:59pm (Asia/Ho_Chi_Minh)` —
//! so a bracketed IANA zone is honoured rather than stripped. Other accepted forms:
//! `tomorrow, 2:50am`, `today 14:30`, `3pm`, `in 2h 13m`, ISO 8601 and epoch seconds/milliseconds.
//! Port of the renderer's `parseReset.ts`; both must accept the same text.

use super::civil::{civil_from_days, days_from_civil, DAY_MS};
use super::iso_time::parse_iso;
use super::pattern::{chars, find, is_alpha, is_digit, is_space, match_at, string, Tok, MANY};
use super::zone;

const MONTHS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

/// A civil date with a 0-based month, as the original used.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CivilDate {
    pub year: i64,
    pub month: i64,
    pub day: i64,
}

fn offset(epoch: i64, zone_name: Option<&str>) -> i64 {
    zone::offset_ms(epoch, zone_name).unwrap_or(0)
}

/// Epoch for a wall-clock time in `zone_name`, or in local time when no zone is given.
pub fn zoned_to_epoch(date: CivilDate, hour: i64, minute: i64, zone_name: Option<&str>) -> i64 {
    let guess = days_from_civil(date.year, date.month + 1, date.day) * DAY_MS
        + hour * 3_600_000
        + minute * 60_000;
    let first = guess - offset(guess, zone_name);
    guess - offset(first, zone_name)
}

fn civil_today(now: i64, zone_name: Option<&str>) -> CivilDate {
    let shifted = now + offset(now, zone_name);
    let (year, month, day) = civil_from_days(shifted.div_euclid(DAY_MS));
    CivilDate {
        year,
        month: month - 1,
        day,
    }
}

fn add_days(date: CivilDate, days: i64) -> CivilDate {
    let (year, month, day) =
        civil_from_days(days_from_civil(date.year, date.month + 1, date.day) + days);
    CivilDate {
        year,
        month: month - 1,
        day,
    }
}

fn is_clock_sep(c: char) -> bool {
    c == ':' || c == '.'
}

fn is_unit(c: char) -> bool {
    matches!(c.to_ascii_lowercase(), 'd' | 'h' | 'm')
}

fn is_sep(c: char) -> bool {
    is_space(c) || c == ','
}

/// `(?:^|[\s,])(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?=$|[\s,])`
const CLOCK: &[Tok] = &[
    Tok::Alt(&[&[Tok::Start], &[Tok::Class(is_sep, 1, 1)]]),
    Tok::Cap(0, &[Tok::Class(is_digit, 1, 2)]),
    Tok::Opt(&[
        Tok::Class(is_clock_sep, 1, 1),
        Tok::Cap(1, &[Tok::Class(is_digit, 2, 2)]),
    ]),
    Tok::Class(is_space, 0, MANY),
    Tok::Opt(&[Tok::Cap(
        2,
        &[Tok::Alt(&[
            &[Tok::Lit("am")],
            &[Tok::Lit("pm")],
            &[Tok::Lit("a.m.")],
            &[Tok::Lit("p.m.")],
        ])],
    )]),
    Tok::Ahead(&[Tok::Alt(&[&[Tok::End], &[Tok::Class(is_sep, 1, 1)]])]),
];

fn parse_clock(text: &str) -> Option<(i64, i64)> {
    let subject = chars(text);
    let found = find(CLOCK, &subject)?;
    let mut hour: i64 = found.group(&subject, 0)?.parse().ok()?;
    let minutes = found.group(&subject, 1);
    let minute: i64 = minutes.as_deref().map_or(Some(0), |m| m.parse().ok())?;
    let meridiem = found
        .group(&subject, 2)
        .map(|m| m.to_ascii_lowercase().replace('.', ""));
    if meridiem.is_none() && minutes.is_none() {
        return None;
    }
    if minute > 59 {
        return None;
    }
    match meridiem.as_deref() {
        Some(half) => {
            if !(1..=12).contains(&hour) {
                return None;
            }
            hour = hour % 12 + if half == "pm" { 12 } else { 0 };
        }
        None if hour > 23 => return None,
        None => {}
    }
    Some((hour, minute))
}

const ORDINAL: &[Tok] = &[Tok::Opt(&[Tok::Alt(&[
    &[Tok::Lit("st")],
    &[Tok::Lit("nd")],
    &[Tok::Lit("rd")],
    &[Tok::Lit("th")],
])])];

/// `\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b`
const MONTH_FIRST: &[Tok] = &[
    Tok::Boundary,
    Tok::Cap(0, &[Tok::Class(is_alpha, 3, 3)]),
    Tok::Class(is_alpha, 0, MANY),
    Tok::Opt(&[Tok::Lit(".")]),
    Tok::Class(is_space, 1, MANY),
    Tok::Cap(1, &[Tok::Class(is_digit, 1, 2)]),
    Tok::Opt(ORDINAL),
    Tok::Boundary,
];

/// `\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\b`
const DAY_FIRST: &[Tok] = &[
    Tok::Boundary,
    Tok::Cap(1, &[Tok::Class(is_digit, 1, 2)]),
    Tok::Opt(ORDINAL),
    Tok::Class(is_space, 1, MANY),
    Tok::Cap(0, &[Tok::Class(is_alpha, 3, 3)]),
    Tok::Class(is_alpha, 0, MANY),
    Tok::Boundary,
];

fn parse_month_day(text: &str) -> Option<(i64, i64, String)> {
    let subject = chars(text);
    let pick = |pattern: &[Tok]| {
        let found = find(pattern, &subject)?;
        let name = found.group(&subject, 0)?.to_ascii_lowercase();
        let month = MONTHS.iter().position(|candidate| *candidate == name)?;
        let day: i64 = found.group(&subject, 1)?.parse().ok()?;
        if !(1..=31).contains(&day) {
            return None;
        }
        let rest = format!(
            "{} {}",
            string(&subject[..found.start]),
            string(&subject[found.end..])
        );
        Some((i64::try_from(month).ok()?, day, rest))
    };
    pick(MONTH_FIRST).or_else(|| pick(DAY_FIRST))
}

const UNIT_ALTERNATIVES: &[Tok] = &[Tok::Alt(&[
    &[Tok::Lit("d")],
    &[Tok::Lit("day"), Tok::Opt(&[Tok::Lit("s")])],
    &[Tok::Lit("h")],
    &[Tok::Lit("hr"), Tok::Opt(&[Tok::Lit("s")])],
    &[Tok::Lit("hour"), Tok::Opt(&[Tok::Lit("s")])],
    &[Tok::Lit("m")],
    &[Tok::Lit("min"), Tok::Opt(&[Tok::Lit("s")])],
    &[Tok::Lit("minute"), Tok::Opt(&[Tok::Lit("s")])],
])];

/// `\bin\s+((?:\d+\s*(?:d|days?|h|hrs?|hours?|m|mins?|minutes?)\s*)+)`
const RELATIVE: &[Tok] = &[
    Tok::Boundary,
    Tok::Lit("in"),
    Tok::Class(is_space, 1, MANY),
    Tok::Cap(
        0,
        &[Tok::Plus(&[
            Tok::Class(is_digit, 1, MANY),
            Tok::Class(is_space, 0, MANY),
            Tok::Alt(&[UNIT_ALTERNATIVES]),
            Tok::Class(is_space, 0, MANY),
        ])],
    ),
];

/// `(\d+)\s*([dhm])`
const AMOUNT: &[Tok] = &[
    Tok::Cap(0, &[Tok::Class(is_digit, 1, MANY)]),
    Tok::Class(is_space, 0, MANY),
    Tok::Cap(1, &[Tok::Class(is_unit, 1, 1)]),
];

fn parse_relative(text: &str, now: i64) -> Option<i64> {
    let subject = chars(text);
    let found = find(RELATIVE, &subject)?;
    let (from, to) = found.caps[0]?;
    let group = &subject[from..to];
    let mut total: i64 = 0;
    let mut at = 0;
    while at <= group.len() {
        let Some(part) = super::pattern::find_from(AMOUNT, group, at) else {
            break;
        };
        let amount: i64 = part.group(group, 0)?.parse().ok()?;
        let unit = match part.group(group, 1)?.to_ascii_lowercase().as_str() {
            "d" => DAY_MS,
            "h" => 3_600_000,
            _ => 60_000,
        };
        total = total.saturating_add(amount.saturating_mul(unit));
        at = part.end.max(part.start + 1);
    }
    (total > 0).then(|| now + total)
}

/// `^resets?\s*(?:at|on)?\s*`
const RESET_PREFIX: &[Tok] = &[
    Tok::Lit("reset"),
    Tok::Opt(&[Tok::Lit("s")]),
    Tok::Class(is_space, 0, MANY),
    Tok::Opt(&[Tok::Alt(&[&[Tok::Lit("at")], &[Tok::Lit("on")]])]),
    Tok::Class(is_space, 0, MANY),
];

fn all_digits(text: &str, len: usize) -> bool {
    text.len() == len && text.bytes().all(|b| b.is_ascii_digit())
}

const TOMORROW: &[Tok] = &[Tok::Boundary, Tok::Lit("tomorrow"), Tok::Boundary];
const TODAY: &[Tok] = &[Tok::Boundary, Tok::Lit("today"), Tok::Boundary];

/// Parse a reset description; `None` when nothing in it is a recognisable time.
pub fn parse_reset_text(raw: &str, now: i64) -> Option<i64> {
    let trimmed = chars(raw.trim());
    let text = match match_at(RESET_PREFIX, &trimmed, 0) {
        Some(found) => string(&trimmed[found.end..]),
        None => string(&trimmed),
    };
    if text.is_empty() {
        return None;
    }
    if all_digits(&text, 10) {
        return text.parse::<i64>().ok().map(|seconds| seconds * 1000);
    }
    if all_digits(&text, 13) {
        return text.parse().ok();
    }
    let iso_head = text.len() >= 11
        && text.as_bytes()[..10].iter().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                *b == b'-'
            } else {
                b.is_ascii_digit()
            }
        });
    if iso_head && text.as_bytes()[10] == b'T' {
        return parse_iso(&text);
    }
    if let Some(relative) = parse_relative(&text, now) {
        return Some(relative);
    }

    let (zone_name, body) = match (
        text.find('('),
        text.find('(')
            .and_then(|open| text[open..].find(')').map(|close| open + close)),
    ) {
        (Some(open), Some(close)) if close > open + 1 => {
            let name = text[open + 1..close].trim().to_string();
            let body = format!("{} {}", &text[..open], &text[close + 1..]);
            (zone::is_known(&name).then_some(name), body)
        }
        _ => (None, text.clone()),
    };
    let zone_name = zone_name.as_deref();
    let today = civil_today(now, zone_name);

    if let Some((month, day, rest)) = parse_month_day(&body) {
        let (hour, minute) = parse_clock(&rest).unwrap_or((0, 0));
        let mut epoch = zoned_to_epoch(
            CivilDate {
                year: today.year,
                month,
                day,
            },
            hour,
            minute,
            zone_name,
        );
        // A January reset read in December belongs to next year.
        if epoch < now - DAY_MS {
            epoch = zoned_to_epoch(
                CivilDate {
                    year: today.year + 1,
                    month,
                    day,
                },
                hour,
                minute,
                zone_name,
            );
        }
        return Some(epoch);
    }
    let (hour, minute) = parse_clock(&body)?;
    let subject = chars(&body);
    if find(TOMORROW, &subject).is_some() {
        return Some(zoned_to_epoch(add_days(today, 1), hour, minute, zone_name));
    }
    let epoch = zoned_to_epoch(today, hour, minute, zone_name);
    if find(TODAY, &subject).is_some() {
        return Some(epoch);
    }
    // A bare time already past today means the same time tomorrow.
    Some(if epoch < now - 60_000 {
        zoned_to_epoch(add_days(today, 1), hour, minute, zone_name)
    } else {
        epoch
    })
}

#[cfg(test)]
#[path = "reset_tests.rs"]
mod tests;
