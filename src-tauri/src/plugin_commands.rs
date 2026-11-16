//! Plugin list IPC commands for OmniTerm's built-in features (Agent Quota, Always Awake).
//!
//! The sandboxed WebAssembly plugins are served by the IDE backend (`idea_host.rs`), whose own
//! `plugin_list` command is why these are prefixed `omni_`.

use tauri::Emitter;

/// Broadcast to every window when a built-in feature is enabled or disabled, so a window that shows
/// its surfaces (Agent Quota, Always Awake) follows it without polling.
pub(crate) const PLUGINS_CHANGED_EVENT: &str = "omniterm://plugins-changed";

pub(crate) fn notify_plugins_changed<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Err(error) = app.emit(PLUGINS_CHANGED_EVENT, ()) {
        log::warn!("could not announce a plugin change: {error}");
    }
}

/// The built-in features as plugin-list rows (`builtin_features.rs`).
#[tauri::command]
pub fn omni_plugin_list<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Vec<serde_json::Value> {
    crate::builtin_features::descriptors(&app)
}

#[tauri::command]
pub fn omni_plugin_set_enabled<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    let changed = crate::builtin_features::set_enabled(&app, &id, enabled)?
        .ok_or_else(|| format!("Unknown built-in feature \"{id}\"."))?;
    notify_plugins_changed(&app);
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use tauri::Listener;

    #[test]
    fn a_plugin_change_reaches_every_listener() {
        let app = crate::test_support::mock_app();
        let heard = Arc::new(AtomicUsize::new(0));
        let counter = heard.clone();
        app.listen(super::PLUGINS_CHANGED_EVENT, move |_| {
            counter.fetch_add(1, Ordering::SeqCst);
        });
        super::notify_plugins_changed(app.handle());
        assert_eq!(heard.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn only_built_in_features_can_be_switched() {
        let app = crate::test_support::mock_app();
        let error = super::omni_plugin_set_enabled(app.handle().clone(), "acme.blur".into(), false)
            .expect_err("an unknown id is refused");
        assert!(error.contains("acme.blur"), "{error}");
    }
}
