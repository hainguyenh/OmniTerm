use super::*;

#[test]
fn selected_source_comes_first_and_the_other_is_the_fallback() {
    let official = vec!["https://github.com/o/r/latest.json".to_owned()];
    let cnb = source_endpoints(official.clone(), UpdateSource::Cnb, None);
    assert!(cnb[0].contains("cnb.cool"));
    assert_eq!(cnb[1], official[0]);
    let github = source_endpoints(official.clone(), UpdateSource::Github, None);
    assert_eq!(github[0], official[0]);
    assert!(github[1].contains("cnb.cool"));
}

#[test]
fn only_an_https_custom_endpoint_replaces_the_official_ones() {
    let official = vec!["https://github.com/o/r/latest.json".to_owned()];
    let custom = source_endpoints(
        official.clone(),
        UpdateSource::Github,
        Some(" https://example.com/u.json ".into()),
    );
    assert_eq!(custom[0], "https://example.com/u.json");
    let rejected = source_endpoints(
        official.clone(),
        UpdateSource::Github,
        Some("http://example.com/u.json".into()),
    );
    assert_eq!(rejected[0], official[0]);
}

#[test]
fn known_totals_report_once_per_percent() {
    let mut throttle = ProgressThrottle::default();
    let events = (0..1000)
        .filter_map(|_| throttle.chunk(10, Some(10_000)))
        .count();
    assert_eq!(events, 101, "0% through 100% inclusive");
    assert_eq!(throttle.downloaded(), 10_000);
}

#[test]
fn unknown_totals_report_per_256_kib() {
    let mut throttle = ProgressThrottle::default();
    let first = throttle.chunk(16 * 1024, None);
    assert_eq!(
        first,
        Some(UpdateProgress::Downloading {
            downloaded: Some(16 * 1024),
            total: None
        })
    );
    assert_eq!(throttle.chunk(16 * 1024, None), None);
}

#[test]
fn progress_serializes_with_the_tag_the_frontend_reads() {
    let json = serde_json::to_value(UpdateProgress::Installing).expect("serializes");
    assert_eq!(json["type"], "installing");
}
