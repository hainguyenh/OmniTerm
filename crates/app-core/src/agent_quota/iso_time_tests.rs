use super::super::civil::utc_ms;
use super::*;

const MINUTE_MS: i64 = 60_000;

#[test]
fn reads_seconds_and_fractions_of_any_length() {
    let base = utc_ms(2026, 9, 25, 5, 59);
    assert_eq!(parse_iso("2026-09-25T05:59:30Z"), Some(base + 30_000));
    assert_eq!(parse_iso("2026-09-25T05:59:00.12Z"), Some(base + 120));
    assert_eq!(parse_iso("2026-09-25T05:59:00.1239Z"), Some(base + 123));
    assert_eq!(parse_iso("2026-09-25T05:59z"), Some(base));
}

#[test]
fn applies_numeric_zone_offsets_with_or_without_a_colon() {
    let wall = utc_ms(2026, 9, 25, 12, 0);
    assert_eq!(
        parse_iso("2026-09-25T12:00+07:00"),
        Some(wall - 7 * 60 * MINUTE_MS)
    );
    assert_eq!(
        parse_iso("2026-09-25T12:00:00-0530"),
        Some(wall + 330 * MINUTE_MS)
    );
}

#[test]
fn reads_a_time_without_a_zone_as_local_time() {
    let local = zoned_to_epoch(
        CivilDate {
            year: 2026,
            month: 8,
            day: 25,
        },
        5,
        59,
        None,
    );
    assert_eq!(parse_iso("2026-09-25T05:59"), Some(local));
    assert_eq!(parse_iso("2026-09-25T05:59:30.5"), Some(local + 30_500));
}

#[test]
fn accepts_midnight_written_as_hour_24_only_on_the_dot() {
    assert_eq!(
        parse_iso("2026-09-25T24:00Z"),
        Some(utc_ms(2026, 9, 26, 0, 0))
    );
    for bad in [
        "2026-09-25T24:01Z",
        "2026-09-25T24:00:01Z",
        "2026-09-25T23:60Z",
        "2026-09-00T05:59Z",
        "2026-09-32T05:59Z",
    ] {
        assert_eq!(parse_iso(bad), None, "{bad}");
    }
}

#[test]
fn rejects_malformed_dates_times_and_zones() {
    for bad in [
        "",
        "2026",
        "2026-x9-25T05:59Z",
        "2026-09-x5T05:59Z",
        "2026/09-25T05:59Z",
        "2026-09/25T05:59Z",
        "2026-09-25 05:59Z",
        "2026-09-25T0x:59Z",
        "2026-09-25T05:5xZ",
        "2026-09-25T05-59Z",
        "2026-09-25T05:59:xxZ",
        "2026-09-25T05:59 UTC",
        "2026-09-25T05:59+07-00",
        "2026-09-25T05:59+07:x0",
        "2026-09-25T05:59+0x00",
        "2026-09-25T05:59+x7:00",
        "2026-09-25T05:59+070",
        "2026-09-25T05:59+07ab",
    ] {
        assert_eq!(parse_iso(bad), None, "{bad}");
    }
}
