use super::*;
use crate::test_support;

#[test]
fn colorfgbg_matches_the_terminal_appearance() {
    assert_eq!(colorfgbg_for_dark_mode(Some(true)), Some("15;0"));
    assert_eq!(colorfgbg_for_dark_mode(Some(false)), Some("0;15"));
    assert_eq!(colorfgbg_for_dark_mode(None), None);
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
    assert!(parts.iter().any(|path| path == std::path::Path::new("/one")));
    assert!(parts.iter().any(|path| path == std::path::Path::new("/two")));

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
    };
    manager.cache_summary(&live);
    let cached = manager.sessions.get("session-1").expect("live session cached");
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
