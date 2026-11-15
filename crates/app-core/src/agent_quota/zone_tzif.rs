//! TZif (zoneinfo) reading for platforms that keep the IANA database on disk.
//!
//! Modern "slim" zoneinfo files list only past transitions and describe the rest with a POSIX TZ
//! rule in their footer (`PST8PDT,M3.2.0,M11.1.0`), so both are read: the transition table up to
//! its last entry, the footer rule after it.

use super::civil::days_from_civil;

/// Weekday of a day number, 0 = Sunday.
fn weekday(days: i64) -> i64 {
    (days + 4).rem_euclid(7)
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct LocalType {
    offset: i64,
}

/// One DST boundary of a POSIX rule: a day of the year and a local time of day.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RuleDay {
    /// `Jn`: day 1–365, February 29 never counted.
    Julian(i64),
    /// `n`: day 0–365, counting February 29.
    Zero(i64),
    /// `Mm.w.d`: weekday `d` of week `w` (5 = last) of month `m`.
    Month(i64, i64, i64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Boundary {
    day: RuleDay,
    seconds: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PosixTz {
    std_offset: i64,
    dst: Option<(i64, Boundary, Boundary)>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Tzif {
    transitions: Vec<(i64, usize)>,
    types: Vec<LocalType>,
    footer: Option<PosixTz>,
}

fn take_name(text: &[u8], at: &mut usize) -> Option<()> {
    if text.get(*at) == Some(&b'<') {
        let close = text[*at..].iter().position(|&b| b == b'>')?;
        *at += close + 1;
        return Some(());
    }
    let start = *at;
    while text.get(*at).is_some_and(|b| b.is_ascii_alphabetic()) {
        *at += 1;
    }
    (*at - start >= 3).then_some(())
}

fn take_number(text: &[u8], at: &mut usize) -> Option<i64> {
    let start = *at;
    while text.get(*at).is_some_and(|b| b.is_ascii_digit()) {
        *at += 1;
    }
    std::str::from_utf8(&text[start..*at]).ok()?.parse().ok()
}

/// `[+-]hh[:mm[:ss]]` in seconds.
fn take_time(text: &[u8], at: &mut usize) -> Option<i64> {
    let sign = match text.get(*at) {
        Some(b'-') => {
            *at += 1;
            -1
        }
        Some(b'+') => {
            *at += 1;
            1
        }
        _ => 1,
    };
    let mut seconds = take_number(text, at)? * 3600;
    for scale in [60, 1] {
        if text.get(*at) != Some(&b':') {
            break;
        }
        *at += 1;
        seconds += take_number(text, at)? * scale;
    }
    Some(sign * seconds)
}

fn take_boundary(text: &[u8], at: &mut usize) -> Option<Boundary> {
    let day = match text.get(*at) {
        Some(b'J') => {
            *at += 1;
            RuleDay::Julian(take_number(text, at)?)
        }
        Some(b'M') => {
            *at += 1;
            let month = take_number(text, at)?;
            (text.get(*at) == Some(&b'.')).then_some(())?;
            *at += 1;
            let week = take_number(text, at)?;
            (text.get(*at) == Some(&b'.')).then_some(())?;
            *at += 1;
            RuleDay::Month(month, week, take_number(text, at)?)
        }
        _ => RuleDay::Zero(take_number(text, at)?),
    };
    let seconds = if text.get(*at) == Some(&b'/') {
        *at += 1;
        take_time(text, at)?
    } else {
        7200
    };
    Some(Boundary { day, seconds })
}

impl PosixTz {
    /// Parse a POSIX TZ string such as `CET-1CEST,M3.5.0,M10.5.0/3` or `<+07>-7`.
    pub(crate) fn parse(rule: &str) -> Option<Self> {
        let text = rule.as_bytes();
        let mut at = 0;
        take_name(text, &mut at)?;
        // POSIX offsets are west-positive.
        let std_offset = -take_time(text, &mut at)?;
        if at == text.len() {
            return Some(Self {
                std_offset,
                dst: None,
            });
        }
        take_name(text, &mut at)?;
        let dst_offset = if text.get(at) == Some(&b',') {
            std_offset + 3600
        } else {
            -take_time(text, &mut at)?
        };
        (text.get(at) == Some(&b',')).then_some(())?;
        at += 1;
        let start = take_boundary(text, &mut at)?;
        (text.get(at) == Some(&b',')).then_some(())?;
        at += 1;
        let end = take_boundary(text, &mut at)?;
        (at == text.len()).then_some(Self {
            std_offset,
            dst: Some((dst_offset, start, end)),
        })
    }

    fn day_of_year_start(year: i64, day: RuleDay) -> i64 {
        let jan1 = days_from_civil(year, 1, 1);
        match day {
            RuleDay::Julian(n) => jan1 + n - 1 + i64::from(is_leap(year) && n >= 60),
            RuleDay::Zero(n) => jan1 + n,
            RuleDay::Month(month, week, wday) => {
                let first = days_from_civil(year, month, 1);
                let mut date = first + (wday - weekday(first)).rem_euclid(7) + (week - 1) * 7;
                let next_month = days_from_civil(year, month + 1, 1);
                while date >= next_month {
                    date -= 7;
                }
                date
            }
        }
    }

    /// UTC offset in seconds at epoch second `t`.
    pub(crate) fn offset_seconds(&self, t: i64) -> i64 {
        let Some((dst_offset, start, end)) = self.dst else {
            return self.std_offset;
        };
        let year = super::civil::civil_from_days((t + self.std_offset).div_euclid(86_400)).0;
        let at = |boundary: Boundary, offset: i64| {
            Self::day_of_year_start(year, boundary.day) * 86_400 + boundary.seconds - offset
        };
        let begins = at(start, self.std_offset);
        let ends = at(end, dst_offset);
        let in_dst = if begins < ends {
            t >= begins && t < ends
        } else {
            !(t >= ends && t < begins)
        };
        if in_dst {
            dst_offset
        } else {
            self.std_offset
        }
    }
}

fn be_u32(data: &[u8], at: usize) -> Option<usize> {
    let bytes: [u8; 4] = data.get(at..at + 4)?.try_into().ok()?;
    usize::try_from(u32::from_be_bytes(bytes)).ok()
}

fn be_i64(data: &[u8], at: usize, wide: bool) -> Option<i64> {
    if wide {
        let bytes: [u8; 8] = data.get(at..at + 8)?.try_into().ok()?;
        Some(i64::from_be_bytes(bytes))
    } else {
        let bytes: [u8; 4] = data.get(at..at + 4)?.try_into().ok()?;
        Some(i64::from(i32::from_be_bytes(bytes)))
    }
}

/// The six counts of a TZif header and the size of the data block they describe.
fn header(data: &[u8], at: usize, wide: bool) -> Option<([usize; 6], usize)> {
    if data.get(at..at + 4)? != b"TZif" {
        return None;
    }
    let mut counts = [0usize; 6];
    for (index, count) in counts.iter_mut().enumerate() {
        *count = be_u32(data, at + 20 + index * 4)?;
    }
    let [isut, isstd, leap, time, kinds, chars] = counts;
    let time_size = if wide { 8 } else { 4 };
    let size = time * time_size + time + kinds * 6 + chars + leap * (time_size + 4) + isstd + isut;
    Some((counts, size))
}

impl Tzif {
    pub(crate) fn utc() -> Self {
        Self {
            transitions: Vec::new(),
            types: vec![LocalType { offset: 0 }],
            footer: None,
        }
    }

    /// Parse a TZif file (versions 1–4).
    pub(crate) fn parse(data: &[u8]) -> Option<Self> {
        let (_, v1_size) = header(data, 0, false)?;
        let version = *data.get(4)?;
        let (base, wide) = if version >= b'2' {
            (44 + v1_size, true)
        } else {
            (0, false)
        };
        let ([_, _, _, time, kinds, _], size) = header(data, base, wide)?;
        let time_size = if wide { 8 } else { 4 };
        let body = base + 44;
        let mut transitions = Vec::with_capacity(time);
        for index in 0..time {
            let at = be_i64(data, body + index * time_size, wide)?;
            let kind = usize::from(*data.get(body + time * time_size + index)?);
            transitions.push((at, kind));
        }
        let types_at = body + time * time_size + time;
        let mut types = Vec::with_capacity(kinds);
        for index in 0..kinds {
            let offset = be_i64(data, types_at + index * 6, false)?;
            types.push(LocalType { offset });
        }
        if types.is_empty() || transitions.iter().any(|&(_, kind)| kind >= types.len()) {
            return None;
        }
        let footer = if wide {
            let rest = data.get(body + size..)?;
            std::str::from_utf8(rest)
                .ok()
                .and_then(|text| PosixTz::parse(text.trim_matches('\n')))
        } else {
            None
        };
        Some(Self {
            transitions,
            types,
            footer,
        })
    }

    /// UTC offset in seconds at epoch second `t`.
    pub(crate) fn offset_seconds(&self, t: i64) -> i64 {
        match self.transitions.last() {
            Some(&(last, _)) if t >= last => {
                if let Some(rule) = &self.footer {
                    return rule.offset_seconds(t);
                }
            }
            None => {
                if let Some(rule) = &self.footer {
                    return rule.offset_seconds(t);
                }
            }
            _ => {}
        }
        let index = self.transitions.partition_point(|&(at, _)| at <= t);
        let kind = if index == 0 {
            0
        } else {
            self.transitions[index - 1].1
        };
        self.types.get(kind).map_or(0, |local| local.offset)
    }
}

#[cfg(not(windows))]
fn zoneinfo_dir() -> std::path::PathBuf {
    std::env::var_os("TZDIR").map_or_else(
        || std::path::PathBuf::from("/usr/share/zoneinfo"),
        std::path::PathBuf::from,
    )
}

/// A named zone from the system database; `None` when the name is not a plain zone path.
#[cfg(not(windows))]
pub(crate) fn load_named(name: &str) -> Option<Tzif> {
    let safe = name.split('/').all(|part| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "_+-".contains(c))
    });
    if !safe {
        return None;
    }
    if name.eq_ignore_ascii_case("UTC") || name.eq_ignore_ascii_case("GMT") {
        return Some(Tzif::utc());
    }
    std::fs::read(zoneinfo_dir().join(name))
        .ok()
        .and_then(|data| Tzif::parse(&data))
}

/// The machine's zone: `TZ` when set, else `/etc/localtime`, else UTC.
#[cfg(not(windows))]
pub(crate) fn load_local() -> Tzif {
    if let Some(tz) = std::env::var("TZ").ok().filter(|value| !value.is_empty()) {
        let name = tz.trim_start_matches(':');
        if let Some(found) = load_named(name) {
            return found;
        }
        if let Some(rule) = PosixTz::parse(name) {
            return Tzif {
                transitions: Vec::new(),
                types: vec![LocalType {
                    offset: rule.std_offset,
                }],
                footer: Some(rule),
            };
        }
    }
    std::fs::read("/etc/localtime")
        .ok()
        .and_then(|data| Tzif::parse(&data))
        .unwrap_or_else(Tzif::utc)
}
