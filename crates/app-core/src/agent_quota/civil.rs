//! Proleptic Gregorian calendar arithmetic on day numbers (days since 1970-01-01).

pub(crate) const DAY_MS: i64 = 86_400_000;

/// Day number of a civil date. `month` is 1-based; a `day` past the month's end rolls over the way
/// `Date.UTC` does, because the result is linear in `day`.
pub(crate) fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    // Normalise the month first so callers may pass 13 (next January) or 0 (last December).
    let year = year + (month - 1).div_euclid(12);
    let month = (month - 1).rem_euclid(12) + 1;
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Civil date `(year, month 1-12, day 1-31)` of a day number.
pub(crate) fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
/// Epoch milliseconds of a UTC wall-clock time.
pub(crate) fn utc_ms(year: i64, month: i64, day: i64, hour: i64, minute: i64) -> i64 {
    days_from_civil(year, month, day) * DAY_MS + hour * 3_600_000 + minute * 60_000
}
