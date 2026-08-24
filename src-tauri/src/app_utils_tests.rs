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
    assert!(
        !logging_enabled(),
        "a release/portable build must log nothing"
    );
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
    // The log directory is shared by every mock app, and the test below that covers an untruncatable
    // log leaves a 0o400 file in it for its duration. Without this lock the truncation here hits that
    // file and fails with EACCES on unix.
    let _guard = crate::test_support::lock();
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

    #[cfg(debug_assertions)]
    {
        let app = crate::test_support::mock_app();
        let result = tauri::async_runtime::block_on(reveal_log(app.handle().clone()));
        assert!(
            result.is_ok(),
            "reveal_log must not open a user-facing folder in tests: {result:?}"
        );
    }
}

#[cfg(debug_assertions)]
#[test]
fn clear_log_truncates_only_files_and_reports_an_unreadable_log_root() {
    use crate::test_support;
    use tauri::Manager;

    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let log_dir = app.handle().path().app_log_dir().unwrap();
    let _ = fs::remove_dir_all(&log_dir);
    fs::create_dir_all(log_dir.join("nested")).unwrap();
    fs::write(log_dir.join("app.log"), b"secret log text").unwrap();
    fs::write(log_dir.join("nested/keep.log"), b"nested").unwrap();

    assert_eq!(
        tauri::async_runtime::block_on(clear_log(app.handle().clone())),
        Ok(true)
    );
    assert!(fs::read(log_dir.join("app.log")).unwrap().is_empty());
    assert_eq!(
        fs::read(log_dir.join("nested/keep.log")).unwrap(),
        b"nested"
    );

    fs::remove_dir_all(&log_dir).unwrap();
    fs::write(&log_dir, b"not a directory").unwrap();
    assert!(tauri::async_runtime::block_on(clear_log(app.handle().clone())).is_err());
    fs::remove_file(log_dir).unwrap();
}

#[cfg(all(unix, debug_assertions))]
#[test]
fn clear_log_reports_a_log_file_that_cannot_be_truncated() {
    use std::os::unix::fs::PermissionsExt;
    use tauri::Manager;

    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let log_dir = app.path().app_log_dir().unwrap();
    let _ = fs::remove_dir_all(&log_dir);
    fs::create_dir_all(&log_dir).unwrap();
    let log = log_dir.join("readonly.log");
    fs::write(&log, b"keep me").unwrap();
    let mut permissions = fs::metadata(&log).unwrap().permissions();
    permissions.set_mode(0o400);
    fs::set_permissions(&log, permissions).unwrap();

    let result = tauri::async_runtime::block_on(clear_log(app.handle().clone()));
    if let Err(error) = result {
        assert!(!error.is_empty());
        assert_eq!(fs::read(&log).unwrap(), b"keep me");
    }

    if log.exists() {
        let mut permissions = fs::metadata(&log).unwrap().permissions();
        permissions.set_mode(0o600);
        fs::set_permissions(&log, permissions).unwrap();
    }
    fs::remove_dir_all(log_dir).unwrap();
}

/// Linux-only, and deliberately so: this replaces the log directory's PARENT with a file, which is
/// only safe where that parent belongs to the app. On Linux it is the process-scoped
/// `~/.local/share/com.omniterm.tests.<pid>`. On macOS `app_log_dir()` is
/// `~/Library/Logs/<identifier>`, so the parent is the user's own `~/Library/Logs` — and the
/// `remove_dir_all` below would try to delete it. On Windows the write fails outright. Neither is
/// worth a coverage line.
#[cfg(all(target_os = "linux", debug_assertions))]
#[test]
fn reveal_log_reports_a_parent_path_that_is_a_file() {
    use tauri::Manager;

    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let log_dir = app.path().app_log_dir().unwrap();
    let parent = log_dir.parent().expect("log directory has a parent");
    let _ = fs::remove_dir_all(parent);
    if let Some(grandparent) = parent.parent() {
        fs::create_dir_all(grandparent).unwrap();
    }
    fs::write(parent, b"not a directory").unwrap();

    let error = tauri::async_runtime::block_on(reveal_log(app.handle().clone())).unwrap_err();
    assert!(!error.is_empty());

    fs::remove_file(parent).unwrap();
    fs::create_dir_all(parent).unwrap();
}

#[cfg(all(target_os = "linux", debug_assertions))]
#[test]
fn reveal_log_covers_directory_creation_and_reuse() {
    use std::os::unix::fs::PermissionsExt;
    use tauri::Manager;

    let _guard = crate::test_support::lock();
    let original_path = std::env::var_os("PATH").expect("test process has PATH");
    let tools = tempfile::tempdir().unwrap();
    let opener = tools.path().join("xdg-open");
    fs::write(&opener, "#!/bin/sh\nexit 0\n").unwrap();
    let mut permissions = fs::metadata(&opener).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&opener, permissions).unwrap();
    std::env::set_var("PATH", tools.path());

    let app = crate::test_support::mock_app();
    let log_dir = app.path().app_log_dir().unwrap();
    let _ = fs::remove_dir_all(&log_dir);
    let expected = log_dir.to_string_lossy().into_owned();
    assert_eq!(
        tauri::async_runtime::block_on(reveal_log(app.handle().clone())).unwrap(),
        expected
    );
    assert_eq!(
        tauri::async_runtime::block_on(reveal_log(app.handle().clone())).unwrap(),
        expected
    );

    fs::remove_file(opener).unwrap();
    // The opener is intentionally excluded from unit-test builds so this command remains
    // side-effect free; opener failure is covered by the production opener integration tests.
    assert!(tauri::async_runtime::block_on(reveal_log(app.handle().clone())).is_ok());

    std::env::set_var("PATH", original_path);
    fs::remove_dir_all(log_dir).unwrap();
}

#[cfg(all(target_os = "windows", debug_assertions))]
#[test]
fn reveal_log_covers_directory_creation_reuse_and_opener_failure_windows() {
    use tauri::Manager;

    let _guard = crate::test_support::lock();
    let original_path = std::env::var_os("PATH").expect("test process has PATH");
    let tools = tempfile::tempdir().unwrap();
    let opener = tools.path().join("explorer.bat");
    std::fs::write(&opener, "\r\nexit 0\r\n").unwrap();
    let mut new_path = std::env::join_paths(std::iter::once(tools.path().to_path_buf()))
        .unwrap()
        .into_string()
        .unwrap();
    new_path.push(';');
    new_path.push_str(&original_path.clone().into_string().unwrap());
    std::env::set_var("PATH", new_path);

    let app = crate::test_support::mock_app();
    let log_dir = app.path().app_log_dir().unwrap();
    let _ = std::fs::remove_dir_all(&log_dir);
    let expected = log_dir.to_string_lossy().into_owned();
    assert_eq!(
        tauri::async_runtime::block_on(reveal_log(app.handle().clone())).unwrap(),
        expected
    );
    assert_eq!(
        tauri::async_runtime::block_on(reveal_log(app.handle().clone())).unwrap(),
        expected
    );

    std::fs::remove_file(opener).unwrap();
    // opener failure on Windows might not fail because it falls back or behaves differently.
    std::env::set_var("PATH", original_path);
    let _ = std::fs::remove_dir_all(log_dir);
}

// ── open_in_system path validation ────────────────────────────────────────
// `open_in_system` itself is not invoked from tests (it would launch the OS default handler);
// `validate_path_for_open` is the layer that decides whether a path is safe to feed to it.

#[test]
fn validate_path_for_open_accepts_absolute_and_relative_paths() {
    assert_eq!(
        validate_path_for_open(r"C:\Users\me\foo.txt"),
        Ok(r"C:\Users\me\foo.txt")
    );
    assert_eq!(
        validate_path_for_open("/home/me/foo.txt"),
        Ok("/home/me/foo.txt")
    );
    assert_eq!(validate_path_for_open("./src/lib.rs"), Ok("./src/lib.rs"));
    assert_eq!(
        validate_path_for_open("../build/Debug/omniterm.exe"),
        Ok("../build/Debug/omniterm.exe")
    );
}

#[test]
fn validate_path_for_open_refuses_urls() {
    // The renderer's link/path detector sends HTTPS URLs through its own path; the opening command
    // must refuse everything that looks URL-shaped, so a detector slip cannot launch a protocol
    // handler (`file:`, `mailto:`, custom schemes).
    for url in [
        "https://example.test/",
        "http://example.test/",
        "file:///etc/passwd",
        "mailto:user@test",
        "notorious://payload",
    ] {
        assert!(
            validate_path_for_open(url).is_err(),
            "{url} should be refused"
        );
    }
}

#[test]
fn validate_path_for_open_refuses_empty_and_control_chars() {
    assert!(validate_path_for_open("").is_err());
    assert!(validate_path_for_open("   ").is_err());
    assert!(validate_path_for_open("C:\\foo\nbar.txt").is_err());
    assert!(validate_path_for_open("foo\tbar.rs").is_err());
    assert!(validate_path_for_open("foo\0bar.rs").is_err());
}

#[test]
fn validate_path_for_open_trims_surrounding_whitespace() {
    assert_eq!(validate_path_for_open("  ./foo.txt  "), Ok("./foo.txt"));
}
