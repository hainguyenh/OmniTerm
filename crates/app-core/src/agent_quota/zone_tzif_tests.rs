use super::super::civil::utc_ms;
use super::*;

const HOUR: i64 = 3600;

fn secs(year: i64, month: i64, day: i64, hour: i64, minute: i64) -> i64 {
    utc_ms(year, month, day, hour, minute) / 1000
}

fn push_header(data: &mut Vec<u8>, version: u8, counts: [usize; 6]) {
    data.extend_from_slice(b"TZif");
    data.push(version);
    data.extend_from_slice(&[0; 15]);
    for count in counts {
        data.extend_from_slice(&u32::try_from(count).expect("small count").to_be_bytes());
    }
}

/// A version 1 file: 32-bit transition times, no footer.
fn tzif_v1(transitions: &[(i32, u8)], offsets: &[i32]) -> Vec<u8> {
    let mut data = Vec::new();
    push_header(&mut data, 0, [0, 0, 0, transitions.len(), offsets.len(), 1]);
    for (at, _) in transitions {
        data.extend_from_slice(&at.to_be_bytes());
    }
    data.extend(transitions.iter().map(|&(_, kind)| kind));
    for offset in offsets {
        data.extend_from_slice(&offset.to_be_bytes());
        data.extend_from_slice(&[0, 0]);
    }
    data.push(0);
    data
}

/// A version 2 file with an empty v1 block, the given v2 table and a raw footer.
fn tzif_v2(transitions: &[(i64, u8)], offsets: &[i32], footer: &[u8]) -> Vec<u8> {
    let mut data = Vec::new();
    push_header(&mut data, b'2', [0, 0, 0, 0, 1, 1]);
    data.extend_from_slice(&[0; 7]);
    push_header(
        &mut data,
        b'2',
        [0, 0, 0, transitions.len(), offsets.len(), 1],
    );
    for (at, _) in transitions {
        data.extend_from_slice(&at.to_be_bytes());
    }
    data.extend(transitions.iter().map(|&(_, kind)| kind));
    for offset in offsets {
        data.extend_from_slice(&offset.to_be_bytes());
        data.extend_from_slice(&[0, 0]);
    }
    data.push(0);
    data.extend_from_slice(footer);
    data
}

#[test]
fn reads_version_one_tables_without_a_footer() {
    let zone = Tzif::parse(&tzif_v1(&[(-100, 0), (1_000, 1)], &[-3600, 5400])).expect("v1 tzif");
    // Before the first transition the first type applies.
    assert_eq!(zone.offset_seconds(-200), -3600);
    assert_eq!(zone.offset_seconds(0), -3600);
    // Past the last transition there is no footer, so the table's last type stays in force.
    assert_eq!(zone.offset_seconds(1_000), 5400);
    assert_eq!(zone.offset_seconds(10_000_000), 5400);
}

#[test]
fn rejects_truncated_or_inconsistent_files() {
    let full = tzif_v1(&[(1_000, 0)], &[3600]);
    for cut in [3, 10, 30, 44, 47, 48, 50] {
        assert_eq!(Tzif::parse(&full[..cut]), None, "cut at {cut}");
    }
    // No local time types at all.
    assert_eq!(Tzif::parse(&tzif_v1(&[], &[])), None);
    // A transition naming a type that does not exist.
    assert_eq!(Tzif::parse(&tzif_v1(&[(5, 1)], &[0])), None);
    // A v2 file whose second header is missing.
    let v2 = tzif_v2(&[], &[0], b"\nUTC0\n");
    assert_eq!(Tzif::parse(&v2[..60]), None);
    let mut bad_magic = v2.clone();
    bad_magic[51] = b'X';
    assert_eq!(Tzif::parse(&bad_magic), None);
    // Cut inside the 64-bit transition times, then just before the abbreviation the footer
    // follows: both are incomplete files.
    let with_transition = tzif_v2(&[(1_000, 0)], &[0], b"");
    assert_eq!(with_transition.len(), 111);
    assert!(Tzif::parse(&with_transition).is_some());
    assert_eq!(Tzif::parse(&with_transition[..100]), None);
    assert_eq!(Tzif::parse(&with_transition[..110]), None);
}

#[test]
fn ignores_an_unreadable_footer_and_falls_back_to_the_table() {
    let not_utf8 = Tzif::parse(&tzif_v2(&[(1_000, 1)], &[0, 7200], b"\n\xff\xfe\n"))
        .expect("tzif with a binary footer");
    assert_eq!(not_utf8.offset_seconds(5_000), 7200);
    let bad_rule =
        Tzif::parse(&tzif_v2(&[], &[1800], b"\nnot a rule\n")).expect("tzif with a bad rule");
    // No transitions and no usable footer: the first type applies everywhere.
    assert_eq!(bad_rule.offset_seconds(0), 1800);
    let empty = Tzif::parse(&tzif_v2(&[], &[0], b"")).expect("tzif without a footer");
    assert_eq!(empty.offset_seconds(123), 0);
}

#[test]
fn parses_offsets_with_signs_minutes_and_seconds() {
    // West-positive: `-5:30` is UTC+5:30, `+3:15:30` is UTC-3:15:30.
    let india = PosixTz::parse("IST-5:30").expect("india");
    assert_eq!(india.offset_seconds(0), 5 * HOUR + 30 * 60);
    let odd = PosixTz::parse("ODD+3:15:30").expect("seconds");
    assert_eq!(odd.offset_seconds(0), -(3 * HOUR + 15 * 60 + 30));
    for bad in [
        "<+07-7",
        "AB5",
        "EST",
        "EST5:",
        "EST5:30:",
        "EST5E",
        "EST5EDT4",
        "EST5EDT,M3",
        "EST5EDT,M3.2",
        "EST5EDT,M3.2.0/",
        "EST5EDT,J",
        "EST5EDT,x,M11.1.0",
        "EST5EDT,M3.2.0,",
        "EST5EDT,Mx,M11.1.0",
        "EST5EDT,M3.x,M11.1.0",
        "EST5EDT,M3.2.x,M11.1.0",
        "EST5EDT-,M3.2.0,M11.1.0",
        "EST99999999999999999999",
    ] {
        assert_eq!(PosixTz::parse(bad), None, "{bad}");
    }
}

#[test]
fn takes_an_explicit_daylight_offset_and_boundary_times() {
    // DST two hours ahead, changing at 01:30 local and back at 03:00 local.
    let rule = PosixTz::parse("AAA3BBB1,M3.5.0/1:30,M10.5.0/3").expect("explicit dst");
    assert_eq!(rule.offset_seconds(secs(2026, 1, 10, 0, 0)), -3 * HOUR);
    assert_eq!(rule.offset_seconds(secs(2026, 7, 10, 0, 0)), -HOUR);
    // March 2026 has its last Sunday on the 29th: 01:30 at UTC-3 is 04:30 UTC.
    assert_eq!(rule.offset_seconds(secs(2026, 3, 29, 4, 29)), -3 * HOUR);
    assert_eq!(rule.offset_seconds(secs(2026, 3, 29, 4, 30)), -HOUR);
}

#[test]
fn counts_julian_days_without_february_29_and_zero_based_days_with_it() {
    let jan1 = days_from_civil(2024, 1, 1);
    // `J60` is March 1 in every year; `59` is February 29 in a leap year, March 1 otherwise.
    assert_eq!(
        PosixTz::day_of_year_start(2024, RuleDay::Julian(60)),
        days_from_civil(2024, 3, 1)
    );
    assert_eq!(
        PosixTz::day_of_year_start(2024, RuleDay::Julian(59)),
        jan1 + 58
    );
    assert_eq!(
        PosixTz::day_of_year_start(2025, RuleDay::Julian(60)),
        days_from_civil(2025, 3, 1)
    );
    assert_eq!(
        PosixTz::day_of_year_start(2024, RuleDay::Zero(59)),
        days_from_civil(2024, 2, 29)
    );
    // The fifth Sunday of February 2026 does not exist, so the last one (the 22nd) is used.
    assert_eq!(
        PosixTz::day_of_year_start(2026, RuleDay::Month(2, 5, 0)),
        days_from_civil(2026, 2, 22)
    );
    assert_eq!(
        PosixTz::day_of_year_start(2026, RuleDay::Month(3, 1, 1)),
        days_from_civil(2026, 3, 2)
    );
    assert!(is_leap(2000));
    assert!(!is_leap(1900));
    assert!(is_leap(2024));
    assert!(!is_leap(2026));
    assert_eq!(weekday(0), 4);
}

#[test]
fn applies_the_footer_only_after_the_last_transition() {
    let zone = Tzif::parse(&tzif_v2(
        &[(0, 0), (1_000, 1)],
        &[3600, 7200],
        b"\nCET-1CEST,M3.5.0,M10.5.0/3\n",
    ))
    .expect("tzif with a dst footer");
    assert_eq!(zone.offset_seconds(-1), 3600);
    assert_eq!(zone.offset_seconds(500), 3600);
    assert_eq!(zone.offset_seconds(secs(2026, 1, 15, 0, 0)), HOUR);
    assert_eq!(zone.offset_seconds(secs(2026, 7, 15, 0, 0)), 2 * HOUR);
}

#[cfg(not(windows))]
#[test]
fn loads_only_plain_zone_names_from_the_system_database() {
    for unsafe_name in [
        "",
        "../etc/passwd",
        "Europe//Berlin",
        "./UTC",
        "Asia/Ho Chi Minh",
    ] {
        assert_eq!(load_named(unsafe_name), None, "{unsafe_name}");
    }
    assert_eq!(load_named("utc"), Some(Tzif::utc()));
    assert_eq!(load_named("GMT"), Some(Tzif::utc()));
    assert_eq!(load_named("Not/AZone"), None);
}
