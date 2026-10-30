//! Native auto-update over GitHub Releases via `tauri-plugin-updater`.
//!
//! Release artifacts are minisign-signed and described by `latest.json` published alongside them
//! (see `scripts/publish-update.mjs`). The signing key pair is generated once per maintainer
//! machine (`pnpm tauri signer generate`) and the private key NEVER leaves it or enters the repo;
//! only the public key is embedded, injected into `tauri.conf.json` by
//! `scripts/configure-tauri-updater.mjs` at build time from the environment.
//!
//! Unsigned/dev builds have no `plugins.updater` config: every command here degrades to a typed
//! "unavailable" result instead of erroring, so local builds stay quiet.

use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::UpdaterExt;

#[cfg(test)]
#[path = "update_manager_tests.rs"]
mod tests;

/// Whether this build can use the native updater at all (config present = signed release build).
///
/// `UpdaterExt::updater()` *panics* when the plugin never registered its state — which is exactly
/// the unsigned-dev case, where the conf carries no `plugins.updater` and lib.rs skips nothing but
/// the endpoints are absent. Catch that panic and report "not configured" instead.
pub fn updater_configured<R: Runtime>(app: &AppHandle<R>) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| app.updater().is_ok()))
        .unwrap_or(false)
}

/// Check GitHub Releases for a newer signed version.
#[tauri::command]
pub async fn check_for_native_update<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    if !updater_configured(&app) {
        return Ok(json!({ "available": false, "reason": "updater-disabled" }));
    }
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    match update {
        Some(update) => Ok(json!({
            "available": true,
            "version": update.version,
            "notes": update.body.clone().unwrap_or_default(),
        })),
        None => Ok(json!({ "available": false, "reason": "up-to-date" })),
    }
}

/// Download the signed bundle, verify it against the embedded public key, install it natively,
/// and relaunch the app (`restart()` never returns on success).
#[tauri::command]
pub async fn download_and_install_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if !updater_configured(&app) {
        return Err("Native updates are disabled in this build.".to_string());
    }
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Already up to date.".to_string())?;
    // Progress reporting rides the renderer's existing state machine in v1: the UI shows an
    // indeterminate installing state while this future runs.
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

/** Restrict browser downloads to official GitHub release pages and their assets. */
fn valid_release_url(url: &str) -> bool {
    const BASE: &str = "https://github.com/hainguyenh/OmniTerm/releases/";
    let Some(path) = url.strip_prefix(BASE) else { return false; };
    if path == "latest" { return true; }
    let mut parts = path.split('/');
    let Some(kind) = parts.next() else { return false; };
    let Some(tag) = parts.next() else { return false; };
    if !tag.starts_with('v') || !tag[1..].chars().all(|c| c.is_ascii_digit() || c == '.')
        || tag[1..].is_empty() { return false; }
    match kind {
        "tag" => parts.next().is_none(),
        "download" => {
            let Some(filename) = parts.next() else { return false; };
            !filename.is_empty() && filename != ".."
                && filename.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
                && [".exe", ".msi", ".zip", ".dmg", ".deb", ".AppImage"]
                    .iter().any(|ext| filename.ends_with(ext))
                && parts.next().is_none()
        }
        _ => false,
    }
}

/// For unsigned builds, ask the system browser to fetch the exact official release asset.
/// This never executes downloads or writes a binary inside OmniTerm.
#[tauri::command]
pub async fn open_update_release_link(url: String) -> Result<(), String> {
    if !valid_release_url(&url) {
        return Err("Update link must be an official OmniTerm GitHub release URL.".into());
    }
    opener::open(&url).map_err(|e| e.to_string())
}

#[cfg(test)]
mod manual_release_tests {
    use super::valid_release_url;

    #[test]
    fn allows_only_official_release_assets_and_pages() {
        assert!(valid_release_url("https://github.com/hainguyenh/OmniTerm/releases/latest"));
        assert!(valid_release_url("https://github.com/hainguyenh/OmniTerm/releases/tag/v0.1.14"));
        assert!(valid_release_url("https://github.com/hainguyenh/OmniTerm/releases/download/v0.1.14/OmniTerm_0.1.14_x64-setup.exe"));
        assert!(valid_release_url("https://github.com/hainguyenh/OmniTerm/releases/download/v0.1.14/OmniTerm_0.1.14_x64-portable.zip"));
        for invalid in [
            "https://github.com@evil.test/hainguyenh/OmniTerm/releases/latest",
            "https://github.com/hainguyenh/Other/releases/latest",
            "http://github.com/hainguyenh/OmniTerm/releases/latest",
            "https://github.com/hainguyenh/OmniTerm/releases/download/v0.1.14/a.exe?evil=1",
            "https://github.com/hainguyenh/OmniTerm/releases/download/v0.1.14/../a.exe",
            "https://github.com/hainguyenh/OmniTerm/releases/download/v0.1.14/a.exe/extra",
        ] { assert!(!valid_release_url(invalid), "{invalid}"); }
    }
}
