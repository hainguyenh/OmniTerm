use serde_json::json;

use super::super::civil::utc_ms;
use super::*;

fn window(kind: WindowKind, label: &str, used_pct: f64) -> QuotaWindow {
    QuotaWindow {
        kind,
        used_pct,
        resets_at: None,
        label: label.to_string(),
        breakdown: None,
    }
}

#[test]
fn classifies_windows_by_length() {
    assert_eq!(
        classify_window_seconds(Some(5.0 * 3600.0)),
        Some(WindowKind::Session)
    );
    assert_eq!(
        classify_window_seconds(Some(7.0 * 86400.0)),
        Some(WindowKind::Weekly)
    );
    assert_eq!(
        classify_window_seconds(Some(30.0 * 86400.0)),
        Some(WindowKind::Monthly)
    );
    assert_eq!(classify_window_seconds(Some(3600.0)), None);
    assert_eq!(classify_window_seconds(None), None);
    assert_eq!(classify_window_seconds(Some(0.0)), None);
}

#[test]
fn reads_numbers_and_times_defensively() {
    assert_eq!(as_number(&json!("4.5")), Some(4.5));
    assert_eq!(as_number(&json!(" ")), None);
    assert_eq!(as_number(&json!("x")), None);
    assert_eq!(as_number(&json!(null)), None);
    assert_eq!(
        to_epoch_ms(Some(&json!(1_790_321_877))),
        Some(1_790_321_877_000)
    );
    assert_eq!(
        to_epoch_ms(Some(&json!(1_790_321_877_000_i64))),
        Some(1_790_321_877_000)
    );
    assert_eq!(
        to_epoch_ms(Some(&json!("2026-09-25T00:00:00Z"))),
        Some(utc_ms(2026, 9, 25, 0, 0))
    );
    assert_eq!(to_epoch_ms(Some(&json!("never"))), None);
    assert_eq!(to_epoch_ms(Some(&json!({}))), None);
    assert_eq!(to_epoch_ms(None), None);
}

#[test]
fn normalises_a_rate_window_falling_back_to_its_position() {
    let value = json!({ "usedPercent": 150, "resetsAt": "2026-09-25T00:00:00Z" });
    let mut expected = window(WindowKind::Session, "5-hour session", 100.0);
    expected.resets_at = Some(utc_ms(2026, 9, 25, 0, 0));
    assert_eq!(
        normalize_rate_window(Some(&value), Some(WindowKind::Session)),
        Some(expected)
    );
    assert_eq!(
        normalize_rate_window(
            Some(&json!({ "used_percent": 5, "window_minutes": 1 })),
            None
        ),
        None
    );
    assert_eq!(
        normalize_rate_window(
            Some(&json!({ "window_minutes": 300 })),
            Some(WindowKind::Session)
        ),
        None
    );
    assert_eq!(
        normalize_rate_window(Some(&json!([])), Some(WindowKind::Session)),
        None
    );
    assert_eq!(normalize_rate_window(None, Some(WindowKind::Session)), None);
}

#[test]
fn keeps_the_fullest_window_of_each_kind_in_order() {
    let kept = worst_per_kind(vec![
        window(WindowKind::Weekly, "a", 10.0),
        window(WindowKind::Session, "b", 5.0),
        window(WindowKind::Weekly, "c", 30.0),
    ]);
    assert_eq!(
        kept.iter().map(|w| w.label.as_str()).collect::<Vec<_>>(),
        ["b", "c"]
    );
}
