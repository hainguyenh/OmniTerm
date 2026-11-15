//! Updater tests. The mock app carries no `plugins.updater` config, which is exactly the
//! unsigned-dev case: commands must degrade to typed "unavailable" results, never error or panic.
//!
//! Test-only exception: the global fixture lock must span the awaited commands below (shared mock
//! app directories), with no real contention under `#[tokio::test]` single-threaded runtimes.
#![allow(clippy::await_holding_lock)]

use super::{
    app_cancel_update, check_for_native_update, download_and_install_update, perform_check,
    update_endpoint_env, updater_configured, InstallingGuard,
};
use crate::ide::requests::Requests;
use crate::test_support::mock_app;
use crate::update_coordinator::UpdatesCoordinator;
use crate::update_progress::source_endpoints;
use ide_core::updates::UpdateSource;
use ide_core::RequestId;
use serde_json::Value;
use std::time::{Duration, Instant};
use tauri::Manager;

#[tokio::test]
async fn the_updater_counts_as_configured_only_when_lib_registered_it() {
    let app = mock_app();
    assert!(!updater_configured(app.handle()), "no marker: not registered");
    app.manage(super::UpdaterRegistered(false));
    assert!(!updater_configured(app.handle()));
    let registered = mock_app();
    registered.manage(super::UpdaterRegistered(true));
    assert!(updater_configured(registered.handle()));
}

#[tokio::test]
async fn a_build_without_updater_config_reports_itself_unconfigured() {
    let app = mock_app();
    assert!(!updater_configured(app.handle()));
}

#[tokio::test]
async fn check_degrades_to_a_typed_unavailable_result_without_config() {
    let _guard = crate::test_support::lock();
    let app = mock_app();
    let result: Value = check_for_native_update(app.handle().clone())
        .await
        .expect("typed result");
    assert_eq!(result["available"], false);
    assert_eq!(result["reason"], "updater-disabled");
}

#[tokio::test]
async fn install_without_config_is_an_error_not_a_crash() {
    let _guard = crate::test_support::lock();
    let app = mock_app();
    let error = download_and_install_update(app.handle().clone())
        .await
        .expect_err("must fail closed");
    assert!(
        error.contains("disabled"),
        "error should name the disable reason: {error}"
    );
}

#[tokio::test]
async fn app_check_update_fails_closed_in_unconfigured_build() {
    let _guard = crate::test_support::lock();
    let app = mock_app();
    let res = perform_check(app.handle(), None)
        .await
        .expect("must return Ok typed result");
    assert!(!res.enabled);
    assert!(res.update.is_none());
}

#[test]
fn installing_guard_enforces_single_flight_execution() {
    let _lock = crate::test_support::lock();
    assert!(!InstallingGuard::is_installing());

    let g1 = InstallingGuard::acquire();
    assert!(g1.is_some(), "First acquisition must succeed");
    assert!(InstallingGuard::is_installing());

    let g2 = InstallingGuard::acquire();
    assert!(g2.is_none(), "Concurrent acquisition must fail");

    drop(g1);
    assert!(!InstallingGuard::is_installing(), "Dropping guard must release lock");

    let g3 = InstallingGuard::acquire();
    assert!(g3.is_some(), "Subsequent acquisition after drop must succeed");
}

#[test]
fn download_cancellation_token_stops_and_is_idempotent() {
    let requests = Requests::default();
    let request_id = RequestId(42);
    let token = requests.begin(request_id);
    assert!(!token.is_cancelled());

    requests.cancel(request_id);
    assert!(token.is_cancelled());

    // Idempotent cancellation
    requests.cancel(request_id);
    assert!(token.is_cancelled());

    requests.end(request_id);
}

#[test]
fn app_cancel_update_cancels_matching_request() {
    let app = mock_app();
    assert!(app.manage(Requests::default()));
    let state = app.state::<Requests>();
    let request_id = RequestId(99);
    let token = state.begin(request_id);
    assert!(!token.is_cancelled());

    let res = app_cancel_update(state, Some("99".to_string())).expect("success");
    assert_eq!(res["cancelled"], true);
    assert_eq!(res["token"], "99");
    assert!(token.is_cancelled());
}

#[test]
fn update_endpoint_environment_variable_precedence() {
    let _lock = crate::test_support::lock();
    std::env::set_var("OMNITERM_UPDATE_ENDPOINT", "https://custom.endpoint/update.json");
    assert_eq!(
        update_endpoint_env(),
        Some("https://custom.endpoint/update.json".to_string())
    );
    std::env::remove_var("OMNITERM_UPDATE_ENDPOINT");
}

#[test]
fn source_endpoints_resolution_prioritizes_selected_endpoint() {
    let official = vec!["https://github.com/omniterm/releases/latest.json".to_string()];
    let cnb = source_endpoints(official.clone(), UpdateSource::Cnb, None);
    assert!(cnb[0].contains("cnb.cool"));
    assert_eq!(cnb[1], official[0]);

    let gh = source_endpoints(official.clone(), UpdateSource::Github, None);
    assert_eq!(gh[0], official[0]);
    assert!(gh[1].contains("cnb.cool"));
}

#[tokio::test]
async fn download_and_install_update_obeys_installing_guard() {
    let _guard = crate::test_support::lock();
    let app = mock_app();
    let _held_guard = InstallingGuard::acquire().expect("must acquire lock");
    let err = download_and_install_update(app.handle().clone())
        .await
        .expect_err("must be rejected by InstallingGuard");
    assert!(
        err.contains("InstallingGuard"),
        "Error should mention InstallingGuard: {err}"
    );
}

#[tokio::test]
async fn coordinator_policy_state_transitions_on_check() {
    let _guard = crate::test_support::lock();
    let app = mock_app();
    let coord = UpdatesCoordinator::default();

    // Initially: checking is false, last_checked is None, due_in is ZERO
    assert!(!coord.state.lock().unwrap().policy.status.checking);
    assert_eq!(coord.state.lock().unwrap().policy.status.last_checked, None);
    assert_eq!(
        coord.state.lock().unwrap().policy.due_in(Instant::now()),
        Duration::ZERO
    );

    // Run check_once
    coord.check_once(app.handle()).await;

    // After check_once: checking is false, last_checked is recorded, due_in is ~4 hours
    let state = coord.state.lock().unwrap();
    assert!(!state.policy.status.checking);
    assert!(state.policy.status.last_checked.is_some());
    assert!(state.policy.due_in(Instant::now()) > Duration::from_secs(3600));
}

#[test]
fn coordinator_announces_version_once_and_deduplicates() {
    let coord = UpdatesCoordinator::default();
    assert!(coord.state.lock().unwrap().policy.announce("0.2.0"));
    assert!(!coord.state.lock().unwrap().policy.announce("0.2.0"));
    assert!(coord.state.lock().unwrap().policy.announce("0.3.0"));
}
