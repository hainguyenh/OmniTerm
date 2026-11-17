use super::super::civil::utc_ms;
use super::super::zone_tzif::{PosixTz, Tzif};
use super::*;

const HOUR_MS: i64 = 3_600_000;

#[test]
fn resolves_named_zones_with_their_daylight_saving() {
    let september = utc_ms(2026, 9, 25, 3, 0);
    assert_eq!(
        offset_ms(september, Some("Asia/Ho_Chi_Minh")),
        Some(7 * HOUR_MS)
    );
    assert_eq!(offset_ms(september, Some("UTC")), Some(0));
    assert_eq!(
        offset_ms(september, Some("America/Los_Angeles")),
        Some(-7 * HOUR_MS)
    );
    assert_eq!(
        offset_ms(utc_ms(2026, 1, 15, 8, 0), Some("Europe/Berlin")),
        Some(HOUR_MS)
    );
    assert_eq!(
        offset_ms(utc_ms(2026, 7, 15, 8, 0), Some("Europe/Berlin")),
        Some(2 * HOUR_MS)
    );
}

#[test]
fn reports_unknown_zones_and_always_has_a_local_one() {
    assert!(is_known("Asia/Ho_Chi_Minh"));
    assert!(!is_known("Not/AZone"));
    assert!(!is_known(""));
    assert_eq!(offset_ms(0, Some("Not/AZone")), None);
    assert!(offset_ms(utc_ms(2026, 9, 25, 3, 0), None).is_some());
}

#[test]
fn applies_posix_rules_in_both_hemispheres() {
    let pacific = PosixTz::parse("PST8PDT,M3.2.0,M11.1.0").expect("pacific rule");
    // 2026-03-08 02:00 PST is 10:00 UTC; 2026-11-01 02:00 PDT is 09:00 UTC.
    assert_eq!(
        pacific.offset_seconds(utc_ms(2026, 3, 8, 9, 59) / 1000),
        -8 * 3600
    );
    assert_eq!(
        pacific.offset_seconds(utc_ms(2026, 3, 8, 10, 0) / 1000),
        -7 * 3600
    );
    assert_eq!(
        pacific.offset_seconds(utc_ms(2026, 11, 1, 8, 59) / 1000),
        -7 * 3600
    );
    assert_eq!(
        pacific.offset_seconds(utc_ms(2026, 11, 1, 9, 0) / 1000),
        -8 * 3600
    );
    let sydney = PosixTz::parse("AEST-10AEDT,M10.1.0,M4.1.0/3").expect("sydney rule");
    assert_eq!(
        sydney.offset_seconds(utc_ms(2026, 1, 10, 0, 0) / 1000),
        11 * 3600
    );
    assert_eq!(
        sydney.offset_seconds(utc_ms(2026, 6, 10, 0, 0) / 1000),
        10 * 3600
    );
    let fixed = PosixTz::parse("<+07>-7").expect("fixed rule");
    assert_eq!(fixed.offset_seconds(0), 7 * 3600);
    let julian = PosixTz::parse("XST3XDT2,J60/1,300/-1:30").expect("day rules");
    assert_eq!(
        julian.offset_seconds(utc_ms(2026, 6, 1, 0, 0) / 1000),
        -2 * 3600
    );
    for bad in [
        "",
        "X1",
        "EST5EDT,M3.2.0",
        "EST5EDT,M3.2,M11.1.0",
        "EST5EDT,M3.2.0,M11.1.0x",
    ] {
        assert!(PosixTz::parse(bad).is_none(), "{bad}");
    }
}

fn tzif_v2(transitions: &[(i64, u8)], offsets: &[i32], footer: &str) -> Vec<u8> {
    let mut data = Vec::new();
    let header = |data: &mut Vec<u8>, version: u8, time: usize, kinds: usize, chars: usize| {
        data.extend_from_slice(b"TZif");
        data.push(version);
        data.extend_from_slice(&[0; 15]);
        for count in [0, 0, 0, time, kinds, chars] {
            data.extend_from_slice(&u32::try_from(count).expect("small count").to_be_bytes());
        }
    };
    header(&mut data, b'2', 0, 1, 1);
    data.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0]);
    header(&mut data, b'2', transitions.len(), offsets.len(), 1);
    for (at, _) in transitions {
        data.extend_from_slice(&at.to_be_bytes());
    }
    data.extend(transitions.iter().map(|&(_, kind)| kind));
    for offset in offsets {
        data.extend_from_slice(&offset.to_be_bytes());
        data.extend_from_slice(&[0, 0]);
    }
    data.push(0);
    data.extend_from_slice(format!("\n{footer}\n").as_bytes());
    data
}

#[test]
fn reads_transition_tables_and_their_footer_rule() {
    let zone = Tzif::parse(&tzif_v2(&[(1_000, 1)], &[3600, 7200], "<+03>-3")).expect("tzif");
    assert_eq!(zone.offset_seconds(0), 3600);
    assert_eq!(zone.offset_seconds(999), 3600);
    assert_eq!(zone.offset_seconds(1_000), 3 * 3600);
    let footer_only = Tzif::parse(&tzif_v2(&[], &[0], "EST5")).expect("footer only");
    assert_eq!(footer_only.offset_seconds(0), -5 * 3600);
    assert_eq!(Tzif::utc().offset_seconds(123), 0);
    assert!(Tzif::parse(b"nope").is_none());
    assert!(Tzif::parse(&tzif_v2(&[(1, 5)], &[0], "UTC0")).is_none());
}

#[test]
fn refuses_zone_names_too_long_to_be_real() {
    let long = format!("Asia/{}", "a".repeat(60));
    assert!(!is_known(&long));
    assert!(is_known("Europe/Berlin"));
}
