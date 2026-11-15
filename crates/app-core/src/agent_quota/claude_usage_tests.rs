use super::super::civil::utc_ms;
use super::super::reset::{zoned_to_epoch, CivilDate};
use super::*;

const CURRENT: &str = include_str!("fixtures/claude-usage/current-2026-09.txt");
const LEGACY: &str = include_str!("fixtures/claude-usage/legacy-inline.txt");
const ANSI: &str = include_str!("fixtures/claude-usage/ansi-panel.txt");
const REMAINING: &str = include_str!("fixtures/claude-usage/remaining-decimal.txt");
const SIGNED_OUT: &str = include_str!("fixtures/claude-usage/not-signed-in.txt");
const MODEL_REPLY: &str = include_str!("fixtures/claude-usage/model-reply.txt");
const PROSE: &str = include_str!("fixtures/claude-usage/prose-only.txt");

/// 2026-09-25 10:00 in Ho Chi Minh City (UTC+7), 2026-09-24 20:00 in Los Angeles (PDT).
fn now() -> i64 {
    utc_ms(2026, 9, 25, 3, 0)
}

fn window(kind: WindowKind, label: &str, used_pct: f64, resets_at: Option<i64>) -> QuotaWindow {
    QuotaWindow {
        kind,
        used_pct,
        resets_at,
        label: label.to_string(),
        breakdown: None,
    }
}

fn windows(text: &str) -> Vec<QuotaWindow> {
    parse_claude_usage(text, now()).expect("a parsed /usage reading")
}

fn error(result: UsageParse) -> QuotaError {
    result.expect_err("an unparsed reading").error
}

#[test]
fn reads_the_current_cli_format_and_ignores_the_percentages_in_its_prose() {
    assert_eq!(
        windows(CURRENT),
        vec![
            window(
                WindowKind::Session,
                "Current session",
                46.0,
                Some(utc_ms(2026, 9, 25, 5, 59))
            ),
            window(
                WindowKind::Weekly,
                "Current week (all models)",
                87.0,
                Some(utc_ms(2026, 9, 25, 15, 59))
            ),
        ]
    );
}

#[test]
fn reads_the_legacy_inline_format_rolling_a_past_bare_time_to_tomorrow() {
    assert_eq!(
        windows(LEGACY),
        vec![
            window(
                WindowKind::Session,
                "Current session",
                45.0,
                Some(utc_ms(2026, 9, 25, 19, 50))
            ),
            window(
                WindowKind::Weekly,
                "Current week (all models)",
                12.0,
                Some(utc_ms(2026, 9, 30, 2, 0))
            ),
        ]
    );
}

#[test]
fn reads_the_bar_panel_with_ansi_colour_and_per_model_weekly_lines() {
    let parsed = windows(ANSI);
    assert_eq!(
        parsed[0],
        window(
            WindowKind::Session,
            "Current session",
            19.0,
            Some(utc_ms(2026, 9, 25, 22, 0))
        )
    );
    let weekly = &parsed[1];
    assert_eq!(
        (weekly.kind, weekly.label.as_str(), weekly.used_pct),
        (WindowKind::Weekly, "Current week (Opus 4)", 33.5)
    );
    assert_eq!(weekly.resets_at, Some(utc_ms(2026, 10, 1, 16, 0)));
    assert_eq!(
        weekly.breakdown,
        Some(vec![
            BreakdownEntry {
                label: "Current week (all models)".into(),
                used_pct: 8.0
            },
            BreakdownEntry {
                label: "Current week (Opus 4)".into(),
                used_pct: 33.5
            },
        ])
    );
}

#[test]
fn converts_remaining_accepts_decimal_commas_crlf_bullets_and_a_monthly_line() {
    let parsed = windows(REMAINING);
    assert_eq!(
        (parsed[0].kind, parsed[0].label.as_str(), parsed[0].used_pct),
        (WindowKind::Session, "5-hour limit", 87.5)
    );
    assert_eq!(parsed[0].resets_at, Some(now() + (2 * 60 + 13) * 60_000));
    let today = super::super::civil::civil_from_days(
        (now() + super::super::zone::offset_ms(now(), None).unwrap_or(0)).div_euclid(86_400_000),
    );
    let tomorrow = CivilDate {
        year: today.0,
        month: today.1 - 1,
        day: today.2 + 1,
    };
    assert_eq!(
        (parsed[1].kind, parsed[1].used_pct),
        (WindowKind::Weekly, 40.5)
    );
    assert_eq!(
        parsed[1].resets_at,
        Some(zoned_to_epoch(tomorrow, 14, 30, None))
    );
    assert_eq!(
        parsed[2],
        window(WindowKind::Monthly, "Monthly limit", 3.0, None)
    );
}

#[test]
fn reports_a_signed_out_profile_distinctly() {
    assert_eq!(
        error(parse_claude_usage(SIGNED_OUT, now())),
        QuotaError::NotSignedIn
    );
}

#[test]
fn never_reads_a_model_reply_or_prose_as_usage() {
    for text in [MODEL_REPLY, PROSE, ""] {
        assert_eq!(
            error(parse_claude_usage(text, now())),
            QuotaError::ParseFailed
        );
    }
}

#[test]
fn requires_the_session_window_and_rejects_impossible_values() {
    assert_eq!(
        error(parse_claude_usage("Current week: 20% used", now())),
        QuotaError::ParseFailed
    );
    assert!(parse_claude_usage("Current session: 150% used", now()).is_err());
    let parsed = windows("Session history\nCurrent session: 5% used");
    assert_eq!(
        (parsed.len(), parsed[0].kind, parsed[0].used_pct),
        (1, WindowKind::Session, 5.0)
    );
}

#[test]
fn reads_the_last_session_window_when_a_screen_holds_more_than_one_panel() {
    let parsed = windows("Current session: 5% used\nCurrent session: 12% used");
    assert_eq!((parsed.len(), parsed[0].used_pct), (1, 12.0));
}

#[test]
fn drops_a_reset_date_too_far_ahead_to_be_real() {
    assert_eq!(
        windows("Current session: 5% used · resets 2026-12-25T00:00:00Z"),
        vec![window(WindowKind::Session, "Current session", 5.0, None)]
    );
}

#[test]
fn stops_reading_below_a_label_at_the_next_label() {
    assert_eq!(
        error(parse_claude_usage(
            "Current session\nCurrent week: 9% used\n",
            now()
        )),
        QuotaError::ParseFailed
    );
}

#[test]
fn normalizes_escapes_glyphs_list_markers_and_separators() {
    let raw = "\u{1b}]0;title\u{7}\u{1b}[1m> Current session\u{1b}[0m \u{2593}\u{2593} | 3% used\r";
    assert_eq!(
        normalize_usage_text(raw),
        vec!["Current session \u{b7} 3% used".to_string()]
    );
}
