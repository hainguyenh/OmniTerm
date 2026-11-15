use super::*;
use crate::test_support;

#[test]
fn colorfgbg_matches_the_terminal_appearance() {
    assert_eq!(colorfgbg_for_dark_mode(Some(true)), Some("15;0"));
    assert_eq!(colorfgbg_for_dark_mode(Some(false)), Some("0;15"));
    assert_eq!(colorfgbg_for_dark_mode(None), None);
}

#[test]
fn command_completion_defaults_on_for_missing_or_malformed_values() {
    assert!(command_completion_enabled(&serde_json::json!({})));
    assert!(command_completion_enabled(
        &serde_json::json!({ "commandCompletion": "no" })
    ));
    assert!(command_completion_enabled(
        &serde_json::json!({ "commandCompletion": true })
    ));
    assert!(!command_completion_enabled(
        &serde_json::json!({ "commandCompletion": false })
    ));
}

#[test]
fn utf8_locale_is_added_only_on_posix_hosts_without_a_locale() {
    let none = |_: &str| None;
    assert_eq!(
        utf8_locale_fallback("macos", none),
        Some(("LANG", "en_US.UTF-8"))
    );
    assert_eq!(utf8_locale_fallback("linux", none), Some(("LANG", "C.UTF-8")));
    assert_eq!(utf8_locale_fallback("windows", none), None);
    for set in ["LC_ALL", "LC_CTYPE", "LANG"] {
        let lookup = |name: &str| (name == set).then(|| OsString::from("vi_VN.UTF-8"));
        assert_eq!(utf8_locale_fallback("linux", lookup), None, "{set} is honoured");
    }
    let empty = |name: &str| (name == "LANG").then(OsString::new);
    assert_eq!(utf8_locale_fallback("linux", empty), Some(("LANG", "C.UTF-8")));
}

#[test]
fn pane_path_prepends_launcher_directory_and_preserves_path() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let original = std::env::var_os("PATH");
    std::env::set_var("PATH", std::env::join_paths(["/one", "/two"]).unwrap());

    let combined = path_with_helper(&handle).expect("PATH should be composed");
    let parts = std::env::split_paths(&combined).collect::<Vec<_>>();
    assert_eq!(parts.first(), Some(&launcher::launcher_bin_dir(&handle)));
    assert!(parts
        .iter()
        .any(|path| path == std::path::Path::new("/one")));
    assert!(parts
        .iter()
        .any(|path| path == std::path::Path::new("/two")));

    match original {
        Some(value) => std::env::set_var("PATH", value),
        None => std::env::remove_var("PATH"),
    }
}

#[test]
fn pane_path_is_none_when_path_is_absent() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let original = std::env::var_os("PATH");
    std::env::remove_var("PATH");
    assert!(path_with_helper(&handle).is_none());
    if let Some(value) = original {
        std::env::set_var("PATH", value);
    }
}

#[test]
fn manager_cache_tracks_live_summary_and_drops_interrupted_summary() {
    let manager = PtyManager::new();
    let live = SessionSummary {
        id: "session-1".to_string(),
        generation: 4,
        policy: PersistencePolicy::RecoverAfterReboot,
        lifecycle: SessionLifecycle::Live,
        pid: Some(42),
        label: "PowerShell".to_string(),
        busy: true,
        launched_with_command: true,
        ssh: false,
        frozen: false,
    };
    manager.cache_summary(&live);
    let cached = manager
        .sessions
        .get("session-1")
        .expect("live session cached");
    assert_eq!(cached.generation, 4);
    assert_eq!(cached.policy, PersistencePolicy::RecoverAfterReboot);
    assert!(cached.busy);
    drop(cached);

    manager.cache_summary(&SessionSummary {
        lifecycle: SessionLifecycle::Interrupted,
        pid: None,
        busy: false,
        ..live
    });
    assert!(!manager.sessions.contains_key("session-1"));
}

#[test]
fn default_manager_starts_unconfigured_and_empty() {
    let manager = PtyManager::default();
    assert!(manager.sessions.is_empty());
    assert!(manager.client().is_err());
}
