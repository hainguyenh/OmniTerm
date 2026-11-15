//! ISO 8601 date-times as agents print them, turned into epoch milliseconds.

use super::civil::{days_from_civil, DAY_MS};
use super::reset::{zoned_to_epoch, CivilDate};

fn number(text: &str, from: usize, len: usize) -> Option<i64> {
    let part = text.get(from..from + len)?;
    part.bytes()
        .all(|b| b.is_ascii_digit())
        .then(|| part.parse().ok())?
}

/// `Date.parse` for the ISO 8601 date-time forms agents print: `YYYY-MM-DDTHH:mm[:ss[.sss]][Z|±HH:mm]`.
/// Without a zone designator the time is local, as in JavaScript.
pub(crate) fn parse_iso(text: &str) -> Option<i64> {
    let year = number(text, 0, 4)?;
    let month = number(text, 5, 2)?;
    let day = number(text, 8, 2)?;
    if text.get(4..5) != Some("-") || text.get(7..8) != Some("-") || text.get(10..11) != Some("T") {
        return None;
    }
    let hour = number(text, 11, 2)?;
    let minute = number(text, 14, 2)?;
    if text.get(13..14) != Some(":") {
        return None;
    }
    let mut at = 16;
    let mut millis = 0;
    if text.get(at..at + 1) == Some(":") {
        millis += number(text, at + 1, 2)? * 1000;
        at += 3;
        if text.get(at..at + 1) == Some(".") {
            let digits = text[at + 1..]
                .bytes()
                .take_while(u8::is_ascii_digit)
                .count();
            if digits == 0 {
                return None;
            }
            let fraction: String = text[at + 1..at + 1 + digits.min(3)]
                .chars()
                .chain("00".chars())
                .take(3)
                .collect();
            millis += fraction.parse::<i64>().ok()?;
            at += 1 + digits;
        }
    }
    let valid = (1..=12).contains(&month)
        && (1..=31).contains(&day)
        && (hour <= 23 || (hour == 24 && minute == 0 && millis == 0))
        && minute <= 59
        && millis < 60_000;
    if !valid {
        return None;
    }
    let wall =
        days_from_civil(year, month, day) * DAY_MS + hour * 3_600_000 + minute * 60_000 + millis;
    let zone_part = &text[at..];
    match zone_part {
        "" => Some(
            zoned_to_epoch(
                CivilDate {
                    year,
                    month: month - 1,
                    day,
                },
                hour,
                minute,
                None,
            ) + millis,
        ),
        "Z" | "z" => Some(wall),
        _ => {
            let sign = match zone_part.as_bytes().first()? {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            let hours = number(zone_part, 1, 2)?;
            let minutes = match zone_part.len() {
                6 if zone_part.get(3..4) == Some(":") => number(zone_part, 4, 2)?,
                5 => number(zone_part, 3, 2)?,
                _ => return None,
            };
            Some(wall - sign * (hours * 3_600_000 + minutes * 60_000))
        }
    }
}
