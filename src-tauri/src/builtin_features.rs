//! Desktop side of the built-in features (Agent Quota, Always Awake): their on/off state lives in
//! the app settings (`app_core::builtin_features`), and they appear in the plugin list so the
//! Plugins dialog can switch them.

use app_core::builtin_features as features;
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

use crate::always_awake::AlwaysAwakeState;
use crate::settings::{merge_shallow, read_settings, write_settings_raw};

pub(crate) fn is_enabled<R: Runtime>(app: &AppHandle<R>, id: &str) -> bool {
    features::is_enabled(&read_settings(app), id)
}

/// The built-in features as plugin-list rows.
pub(crate) fn descriptors<R: Runtime>(app: &AppHandle<R>) -> Vec<Value> {
    features::descriptors(&read_settings(app), &app.package_info().version.to_string())
}

/// Switch a built-in feature; `Ok(None)` when `id` is not one.
pub(crate) fn set_enabled<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    enabled: bool,
) -> Result<Option<Value>, String> {
    let settings = read_settings(app);
    let Some(patch) = features::enabled_patch(&settings, id, enabled) else {
        return Ok(None);
    };
    let merged = merge_shallow(&settings, &patch);
    write_settings_raw(app, merged.clone())?;
    if id == features::ALWAYS_AWAKE {
        if let Some(state) = app.try_state::<AlwaysAwakeState>() {
            state.set_feature_enabled(enabled);
        }
    }
    let version = app.package_info().version.to_string();
    Ok(features::descriptors(&merged, &version)
        .into_iter()
        .find(|row| row["id"] == id))
}

#[cfg(test)]
#[path = "builtin_features_tests.rs"]
mod tests;
