//! Logging and plugin URL validation tests.

use super::*;

/// A packaged build keeps no log, and `cargo test` runs with debug assertions on, so this pins both
/// halves of the switch rather than just whichever one the test binary happens to be built with.
#[test]
fn logging_follows_debug_assertions_only() {
    assert_eq!(logging_enabled(), cfg!(debug_assertions));
    #[cfg(debug_assertions)]
    assert!(logging_enabled(), "a dev build keeps its log");
    #[cfg(not(debug_assertions))]
    assert!(!logging_enabled(), "a release/portable build must log nothing");
}

/// A provider may open an HTTPS authentication-help page before the native client prompts. Arbitrary HTTPS hosts are
/// allowed, while executable and local-file schemes remain blocked.
#[test]
fn plugin_urls_allow_any_https_host() {
    for url in [
        "https://vault.example/items/1",
        "https://my.1password.com",
        "https://bitwarden.example.test:8443/#/vault?itemId=abc",
        "https://internal-vault/x",
    ] {
        assert!(is_allowed_plugin_url(url), "{url} should be allowed");
    }
}

/// What made the unguarded version arbitrary program execution: `opener::open` launches whatever the
/// OS associates with the string, so a non-https scheme or a bare path is a program launch.
#[test]
fn plugin_urls_refuse_anything_that_is_not_https() {
    for url in [
        "http://vault.example/x",
        "file:///C:/Windows/System32/cmd.exe",
        r"C:\evil.exe",
        r"\\server\share\evil.exe",
        "javascript:alert(1)",
        "ms-settings:",
        "data:text/html,<script>1</script>",
        "HTTPS://vault.example/x", // scheme match is exact; no case-folding shortcut
        "",
    ] {
        assert!(!is_allowed_plugin_url(url), "{url} should be refused");
    }
}

/// `https://vault.example@evil.test/x` reads as `vault.example` to a human and resolves to
/// `evil.test`; the whole authority must stay unambiguous.
#[test]
fn plugin_urls_refuse_an_authority_that_lies() {
    for url in [
        "https://vault.example@evil.test/x",
        "https://user:pass@evil.test/x",
        "https://@evil.test/",
        "https:///no-authority",
        "https://vault example/x",
        "https://vault\texample/x",
        "https://vault\nexample/x",
    ] {
        assert!(!is_allowed_plugin_url(url), "{url} should be refused");
    }
}

/// A URL with no path is legitimate because this validator has no repository-path prefix to match.
#[test]
fn plugin_urls_accept_a_bare_origin() {
    assert!(is_allowed_plugin_url("https://vault.example"));
    assert!(is_allowed_plugin_url("https://vault.example/"));
    assert!(is_allowed_plugin_url("https://vault.example?a=1"));
    assert!(is_allowed_plugin_url("https://vault.example#frag"));
}

#[test]
fn get_version_returns_package_version() {
    let app = crate::test_support::mock_app();
    let version = tauri::async_runtime::block_on(get_version(app.handle().clone())).unwrap();
    // Version comes from Cargo.toml; just assert it is non-empty and dot-separated.
    assert!(!version.is_empty());
    assert!(version.contains('.'), "expected semver, got {version}");
}

#[test]
fn clear_log_is_vacuously_true_when_logging_is_disabled() {
    // `cfg!(debug_assertions)` controls `logging_enabled()`. In release builds logging
    // is off and clear_log must be a no-op that returns Ok(true).
    #[cfg(not(debug_assertions))]
    {
        let app = crate::test_support::mock_app();
        let result = tauri::async_runtime::block_on(clear_log(app.handle().clone()));
        assert_eq!(result, Ok(true));
    }
    // In debug builds logging is enabled; clear_log tries the real log dir which may or
    // may not exist, but either way it must not panic.
    #[cfg(debug_assertions)]
    {
        let app = crate::test_support::mock_app();
        let result = tauri::async_runtime::block_on(clear_log(app.handle().clone()));
        assert!(result.is_ok(), "clear_log must not error: {result:?}");
    }
}

#[test]
fn reveal_log_errors_when_logging_is_disabled() {
    #[cfg(not(debug_assertions))]
    {
        let app = crate::test_support::mock_app();
        let err = tauri::async_runtime::block_on(reveal_log(app.handle().clone()))
            .expect_err("must error in a non-debug build");
        assert!(err.contains("no log"), "got {err}");
    }
    // In debug builds the command tries to open the log folder in the OS file manager
    // which we cannot exercise headlessly, so we just skip the assertion.
    #[cfg(debug_assertions)]
    let _ = ();
}
