//! Updater tests. The mock app carries no `plugins.updater` config, which is exactly the
//! unsigned-dev case: commands must degrade to typed "unavailable" results, never error or panic.
//!
//! Test-only exception: the global fixture lock must span the awaited commands below (shared mock
//! app directories), with no real contention under `#[tokio::test]` single-threaded runtimes.
#![allow(clippy::await_holding_lock)]

use super::{check_for_native_update, updater_configured};
use crate::test_support::mock_app;
use serde_json::Value;

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
    let error = super::download_and_install_update(app.handle().clone())
        .await
        .expect_err("must fail closed");
    assert!(
        error.contains("disabled"),
        "error should name the disable reason: {error}"
    );
}
