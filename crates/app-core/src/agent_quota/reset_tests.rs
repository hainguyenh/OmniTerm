use super::super::civil::utc_ms;
use super::*;

/// 2026-09-25 03:00 UTC.
fn now() -> i64 {
    utc_ms(2026, 9, 25, 3, 0)
}

/// A local wall-clock time `days` after today, as `new Date(y, m, d + days, h, mi)` gives it.
fn local(days: i64, hour: i64, minute: i64) -> i64 {
    zoned_to_epoch(add_days(civil_today(now(), None), days), hour, minute, None)
}

#[test]
fn honours_a_bracketed_iana_zone() {
    assert_eq!(
        parse_reset_text("Sep 25, 12:59pm (Asia/Ho_Chi_Minh)", now()),
        Some(utc_ms(2026, 9, 25, 5, 59))
    );
    assert_eq!(
        parse_reset_text("resets 25 Sep 1pm (UTC)", now()),
        Some(utc_ms(2026, 9, 25, 13, 0))
    );
    assert_eq!(
        parse_reset_text("tomorrow, 2:50am (Asia/Ho_Chi_Minh)", now()),
        Some(utc_ms(2026, 9, 25, 19, 50))
    );
    assert_eq!(
        parse_reset_text("today 6pm (UTC)", now()),
        Some(utc_ms(2026, 9, 25, 18, 0))
    );
}

#[test]
fn falls_back_to_local_time_for_a_missing_or_unknown_zone() {
    assert_eq!(
        parse_reset_text("tomorrow, 14:30", now()),
        Some(local(1, 14, 30))
    );
    let tonight = local(0, 23, 59);
    let expected = if tonight < now() - 60_000 {
        local(1, 23, 59)
    } else {
        tonight
    };
    assert_eq!(
        parse_reset_text("Resets at 11:59pm (Not/AZone)", now()),
        Some(expected)
    );
    let september_26 = zoned_to_epoch(
        CivilDate {
            year: 2026,
            month: 8,
            day: 26,
        },
        0,
        0,
        None,
    );
    assert_eq!(parse_reset_text("Sep 26", now()), Some(september_26));
}

#[test]
fn handles_midnight_and_noon_in_twelve_hour_form() {
    assert_eq!(
        parse_reset_text("Sep 26, 12am (UTC)", now()),
        Some(utc_ms(2026, 9, 26, 0, 0))
    );
    assert_eq!(
        parse_reset_text("Sep 26, 12:00 p.m. (UTC)", now()),
        Some(utc_ms(2026, 9, 26, 12, 0))
    );
}

#[test]
fn moves_a_january_date_seen_in_december_into_next_year() {
    let december = utc_ms(2026, 12, 30, 12, 0);
    assert_eq!(
        parse_reset_text("Jan 2, 9am (UTC)", december),
        Some(utc_ms(2027, 1, 2, 9, 0))
    );
}

#[test]
fn reads_relative_iso_and_epoch_forms() {
    assert_eq!(
        parse_reset_text("in 1d 2h 5m", now()),
        Some(now() + ((24 + 2) * 60 + 5) * 60_000)
    );
    assert_eq!(
        parse_reset_text("in 45 minutes", now()),
        Some(now() + 45 * 60_000)
    );
    assert_eq!(
        parse_reset_text("2026-09-25T05:59:00Z", now()),
        Some(utc_ms(2026, 9, 25, 5, 59))
    );
    assert_eq!(
        parse_reset_text("2026-09-25T05:59:00.250+07:00", now()),
        Some(utc_ms(2026, 9, 24, 22, 59) + 250)
    );
    assert_eq!(
        parse_reset_text("1790321877", now()),
        Some(1_790_321_877_000)
    );
    assert_eq!(
        parse_reset_text("1790321877000", now()),
        Some(1_790_321_877_000)
    );
}

#[test]
fn returns_none_for_anything_that_is_not_a_time() {
    for text in [
        "",
        "resets",
        "soon",
        "13pm",
        "25:00",
        "9:75",
        "Foo 12",
        "2026-99-99Tnope",
        "in 0m",
        "40 of 32",
    ] {
        assert_eq!(parse_reset_text(text, now()), None, "{text}");
    }
}

#[test]
fn resolves_wall_clock_time_across_a_dst_change() {
    // 2026-11-01 01:30 in New York happens twice; either reading is an hour apart at most.
    let epoch = zoned_to_epoch(
        CivilDate {
            year: 2026,
            month: 10,
            day: 1,
        },
        1,
        30,
        Some("America/New_York"),
    );
    assert!(
        [utc_ms(2026, 11, 1, 5, 30), utc_ms(2026, 11, 1, 6, 30)].contains(&epoch),
        "{epoch}"
    );
    let berlin = zoned_to_epoch(
        CivilDate {
            year: 2026,
            month: 0,
            day: 15,
        },
        9,
        0,
        Some("Europe/Berlin"),
    );
    assert_eq!(berlin, utc_ms(2026, 1, 15, 8, 0));
}

#[test]
fn parses_iso_strictly() {
    assert_eq!(
        parse_iso("2026-09-25T05:59Z"),
        Some(utc_ms(2026, 9, 25, 5, 59))
    );
    assert_eq!(
        parse_iso("2026-09-25T05:59:00.5Z"),
        Some(utc_ms(2026, 9, 25, 5, 59) + 500)
    );
    for bad in [
        "2026-13-01T00:00Z",
        "2026-09-25T25:00Z",
        "2026-09-25T05:59:00.Z",
        "2026-09-25T05:59+7",
        "0000-00-00T00:00:00Z",
    ] {
        assert_eq!(parse_iso(bad), None, "{bad}");
    }
}
