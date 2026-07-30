//! External-open allowlist and platform-reporting tests.

use super::*;

/// The regression this guards: `opener::open` on a renderer-supplied string launches whatever the OS
/// associates with it. None of these may ever reach the OS.
#[test]
fn refuses_everything_that_is_not_an_https_release_url() {
    for hostile in [
        r"C:\Windows\System32\calc.exe",
        "calc.exe",
        "file:///C:/Windows/System32/calc.exe",
        "file:///etc/passwd",
        r"\\attacker.test\share\payload.exe",
        "ms-msdt:/id",
        "vscode://x",
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "http://github.com/owner/repo/releases",   // plaintext
        "https://evil.test/owner/repo/releases",   // wrong host
        "https://github.com.evil.test/owner/repo", // suffix-confusion host
        "https://github.com@evil.test/owner/repo", // credentials trick
        "https://github.com",                      // no path
        "",
    ] {
        assert!(
            !is_allowed_external(hostile),
            "{hostile:?} must not be openable"
        );
    }
}

/// With `RELEASE_REPO_PATH` empty, external opens are disabled outright — the same state the Electron
/// build ships in. This test pins that so enabling it is a deliberate edit, not an accident.
#[test]
fn external_opens_are_disabled_while_no_release_repo_is_configured() {
    assert!(RELEASE_REPO_PATH.is_empty());
    assert!(!is_allowed_external(
        "https://github.com/owner/repo/releases/tag/v1.0.0"
    ));
}

/// Guards the matching logic itself, so it is known-good whenever a release repo is configured.
/// Mirrors `is_allowed_external` with a non-empty prefix.
#[test]
fn the_prefix_check_only_admits_https_release_paths_on_the_release_host() {
    fn allowed(url: &str, repo_path: &str) -> bool {
        let Some(rest) = url.strip_prefix("https://") else {
            return false;
        };
        let Some((authority, path)) = rest.split_once('/') else {
            return false;
        };
        if authority != RELEASE_HOST {
            return false;
        }
        format!("/{path}").starts_with(repo_path)
    }

    let repo = "/omniterm/omniterm";
    assert!(allowed(
        "https://github.com/omniterm/omniterm/releases/latest",
        repo
    ));
    assert!(!allowed("https://github.com/someone-else/repo", repo));
    assert!(!allowed("http://github.com/omniterm/omniterm", repo));
    assert!(!allowed("https://evil.test/omniterm/omniterm", repo));
    assert!(!allowed("https://github.com@evil.test/omniterm/omniterm", repo));
    // A port on the authority is not the bare release host.
    assert!(!allowed("https://github.com:8443/omniterm/omniterm", repo));
}

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

#[test]
fn platform_is_reported_using_node_names() {
    let p = current_platform();
    assert!(
        ["win32", "darwin", "linux", "unknown"].contains(&p),
        "got {p}"
    );
    #[cfg(target_os = "windows")]
    assert_eq!(p, "win32");
    #[cfg(target_os = "macos")]
    assert_eq!(p, "darwin");
    #[cfg(target_os = "linux")]
    assert_eq!(p, "linux");
}

/// The plugin opener is intentionally wider than `is_allowed_external`: a provider may open an
/// HTTPS authentication-help page before the native client prompts. Arbitrary HTTPS hosts are
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
/// `evil.test` — the same confusion `is_allowed_external`'s whole-authority comparison closes.
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

/// A URL with no path is legitimate and must not be rejected the way `is_allowed_external` rejects it
/// (that one needs a path to match a path prefix against; this one has no prefix to match).
#[test]
fn plugin_urls_accept_a_bare_origin() {
    assert!(is_allowed_plugin_url("https://vault.example"));
    assert!(is_allowed_plugin_url("https://vault.example/"));
    assert!(is_allowed_plugin_url("https://vault.example?a=1"));
    assert!(is_allowed_plugin_url("https://vault.example#frag"));
}
