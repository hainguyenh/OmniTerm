use super::super::civil::utc_ms;
use super::super::iso_time::parse_iso;
use super::*;

const USER_FIXTURE: &str = "Quota:
Gemini Models          Weekly Limit Remaining     55%   2026-10-02T08:47:03Z
Gemini Models          Five Hour Limit Remaining  82%   2026-09-28T07:11:00Z
Claude and GPT models  Weekly Limit Remaining     100%  2026-10-05T03:34:51Z
Claude and GPT models  Five Hour Limit Remaining  100%  2026-09-28T08:34:51Z";

const TAB_FIXTURE: &str = "Gemini Models\tWeekly Limit Remaining\t55%\t2026-10-02T08:47:03Z
Gemini Models\tFive Hour Limit Remaining\t80%\t2026-09-28T07:11:00Z
Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-10-05T03:42:50Z
Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-09-28T08:42:50Z";

const EXHAUSTED_CLAUDE: &str =
    "Gemini Models          Five Hour Limit Remaining  39%   2026-09-28T07:11:00Z
Gemini Models          Weekly Limit Remaining     60%   2026-10-02T08:47:03Z
Claude and GPT models  Five Hour Limit Remaining  0%    2026-09-28T08:34:51Z
Claude and GPT models  Weekly Limit Remaining     10%   2026-10-05T03:34:51Z";

fn now() -> i64 {
    utc_ms(2026, 9, 28, 3, 30)
}

fn iso(text: &str) -> Option<i64> {
    parse_iso(text)
}

fn parsed(raw: &str, active: Option<ModelFamily>) -> Vec<QuotaWindow> {
    parse_agy_usage(raw, now(), active).expect("a parsed agy reading")
}

fn find(windows: &[QuotaWindow], kind: WindowKind) -> &QuotaWindow {
    windows
        .iter()
        .find(|window| window.kind == kind)
        .expect("window of that kind")
}

fn entries(pairs: &[(&str, f64)]) -> Option<Vec<BreakdownEntry>> {
    Some(
        pairs
            .iter()
            .map(|(label, used_pct)| BreakdownEntry {
                label: (*label).to_string(),
                used_pct: *used_pct,
            })
            .collect(),
    )
}

#[test]
fn strips_ansi_colour_codes_and_carriage_returns() {
    let raw = "\u{1b}[32mGemini Models\u{1b}[0m\tWeekly Limit Remaining\t55%\r\n";
    assert_eq!(
        normalize_agy_text(raw),
        vec!["Gemini Models\tWeekly Limit Remaining\t55%".to_string()]
    );
}

#[test]
fn parses_the_multi_model_quota_output() {
    let windows = parsed(USER_FIXTURE, None);
    assert_eq!(windows.len(), 2);
    let session = find(&windows, WindowKind::Session);
    assert_eq!(
        (session.used_pct, session.resets_at),
        (18.0, iso("2026-09-28T07:11:00Z"))
    );
    assert_eq!(
        session.breakdown,
        entries(&[("Gemini Models", 18.0), ("Claude and GPT models", 0.0)])
    );
    let weekly = find(&windows, WindowKind::Weekly);
    assert_eq!(
        (weekly.used_pct, weekly.resets_at),
        (45.0, iso("2026-10-02T08:47:03Z"))
    );
    assert_eq!(
        weekly.breakdown,
        entries(&[("Gemini Models", 45.0), ("Claude and GPT models", 0.0)])
    );
}

#[test]
fn parses_tab_delimited_output() {
    let windows = parsed(TAB_FIXTURE, None);
    assert_eq!(find(&windows, WindowKind::Session).used_pct, 20.0);
    assert_eq!(
        find(&windows, WindowKind::Session).resets_at,
        iso("2026-09-28T07:11:00Z")
    );
    assert_eq!(find(&windows, WindowKind::Weekly).used_pct, 45.0);
}

#[test]
fn omits_the_breakdown_for_a_single_model_and_honours_used_lines() {
    let windows = parsed(
        "Gemini Models  Five Hour Limit Remaining  75%  2026-09-28T07:11:00Z",
        None,
    );
    assert_eq!(windows.len(), 1);
    assert_eq!(
        (
            windows[0].kind,
            windows[0].used_pct,
            windows[0].breakdown.is_none()
        ),
        (WindowKind::Session, 25.0, true)
    );
    assert_eq!(
        parsed(
            "Gemini Models  Five Hour Limit Used  35%  2026-09-28T07:11:00Z",
            None
        )[0]
        .used_pct,
        35.0
    );
}

#[test]
fn detects_signed_out_output_and_output_without_windows() {
    for text in ["Please run /login to authenticate", "User not logged in"] {
        assert_eq!(
            parse_agy_usage(text, now(), None)
                .expect_err("signed out")
                .error,
            QuotaError::NotSignedIn
        );
    }
    for text in [
        "Hello world",
        "",
        "Gemini Models Daily Limit Remaining 50% 2026-09-28T07:11:00Z",
        "Gemini Models Five Hour Limit Remaining 150% 2026-09-28T07:11:00Z",
    ] {
        assert_eq!(
            parse_agy_usage(text, now(), None)
                .expect_err("unparsed")
                .error,
            QuotaError::ParseFailed,
            "{text}"
        );
    }
}

#[test]
fn parses_monthly_windows_relative_resets_and_the_default_model_name() {
    let monthly = parsed(
        "Gemini Models Monthly Limit Remaining 50% 2026-10-30T00:00:00Z",
        None,
    );
    assert_eq!(
        (monthly[0].kind, monthly[0].used_pct),
        (WindowKind::Monthly, 50.0)
    );
    let relative = parse_agy_usage(
        "Five Hour Limit Remaining 80% resets in 2 hours",
        utc_ms(2026, 9, 28, 5, 0),
        None,
    )
    .expect("relative");
    assert_eq!(
        (
            relative[0].kind,
            relative[0].used_pct,
            relative[0].resets_at
        ),
        (WindowKind::Session, 20.0, Some(utc_ms(2026, 9, 28, 7, 0)))
    );
    assert_eq!(
        parsed("Five Hour Limit Remaining 80%", None)[0].resets_at,
        None
    );
    assert_eq!(
        parsed("Five Hour Limit Remaining 80% 0000-00-00T00:00:00Z", None)[0].resets_at,
        None
    );
}

#[test]
fn synthesizes_an_untouched_session_window_when_only_the_weekly_one_is_reported() {
    let windows = parsed(
        "Gemini Models Weekly Limit Remaining 49% 2026-10-02T08:47:03Z",
        None,
    );
    assert_eq!(windows.len(), 2);
    assert_eq!(
        windows[0],
        QuotaWindow {
            kind: WindowKind::Session,
            used_pct: 0.0,
            resets_at: None,
            label: "Session (5h)".into(),
            breakdown: None,
        }
    );
    assert_eq!(find(&windows, WindowKind::Weekly).used_pct, 51.0);
}

#[test]
fn selects_the_active_model_family_when_one_pool_is_exhausted() {
    let gemini = parsed(EXHAUSTED_CLAUDE, Some(ModelFamily::Gemini));
    let session = find(&gemini, WindowKind::Session);
    assert_eq!(session.used_pct, 61.0);
    assert_eq!(
        session.breakdown,
        entries(&[("Gemini Models", 61.0), ("Claude and GPT models", 100.0)])
    );
    assert_eq!(
        find(
            &parsed(EXHAUSTED_CLAUDE, Some(ModelFamily::Claude)),
            WindowKind::Session
        )
        .used_pct,
        100.0
    );
    // Without a known family Gemini, agy's default pool, is preferred.
    assert_eq!(
        find(&parsed(EXHAUSTED_CLAUDE, None), WindowKind::Session).used_pct,
        61.0
    );
    let announced = format!("Active model: claude-sonnet\n{EXHAUSTED_CLAUDE}");
    assert_eq!(
        find(&parsed(&announced, None), WindowKind::Session).used_pct,
        100.0
    );
}
