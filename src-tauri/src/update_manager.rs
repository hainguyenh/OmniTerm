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
