//! Plugin host IPC commands.

use crate::plugin_host::PluginHost;
use tauri::{Emitter, State};

/// Broadcast to every window when a plugin or built-in feature is enabled, disabled or removed, so
/// a window that shows its surfaces (Agent Quota, Always Awake) follows it without polling.
pub(crate) const PLUGINS_CHANGED_EVENT: &str = "omniterm://plugins-changed";

pub(crate) fn notify_plugins_changed<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Err(error) = app.emit(PLUGINS_CHANGED_EVENT, ()) {
        log::warn!("could not announce a plugin change: {error}");
    }
}

#[tauri::command]
pub async fn plugin_available<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    host: State<'_, PluginHost>,
) -> Result<bool, String> {
    host.start(&app).await?;
    Ok(host.is_available().await)
}

/// OmniTerm's plugins: the built-in features first (`builtin_features.rs`), then the Node plugins.
/// Prefixed so it never answers the IDE backend's own `plugin_list` (sandboxed WebAssembly
/// plugins), which shares the invoke handler (`idea_host.rs`).
#[tauri::command]
pub async fn omni_plugin_list<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    host: State<'_, PluginHost>,
) -> Result<Vec<serde_json::Value>, String> {
    let mut plugins = crate::builtin_features::descriptors(&app);
    // The built-in features need no plugin host; a host that cannot start leaves them listed.
    let node = match host.start(&app).await {
        Ok(()) => host.list_plugins().await,
        Err(error) => Err(error),
    };
    match node {
        Ok(list) => plugins.extend(list),
        Err(error) => log::warn!("[plugins] the plugin host did not list its plugins: {error}"),
    }
    Ok(plugins)
}

#[tauri::command]
pub async fn omni_plugin_set_enabled<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    host: State<'_, PluginHost>,
    id: String,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    let changed = match crate::builtin_features::set_enabled(&app, &id, enabled)? {
        Some(feature) => feature,
        None => host.set_enabled(id, enabled).await?,
    };
    notify_plugins_changed(&app);
    Ok(changed)
}

#[tauri::command]
pub async fn plugin_select_connection_provider(
    host: State<'_, PluginHost>,
    id: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    host.select_connection_provider(id).await
}

#[tauri::command]
pub async fn connection_provider_capabilities(
    host: State<'_, PluginHost>,
) -> Result<Option<serde_json::Value>, String> {
    host.connection_capabilities().await
}

#[tauri::command]
pub async fn plugin_invoke(
    host: State<'_, PluginHost>,
    method: String,
    args: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    host.invoke(method, args).await
}

#[tauri::command]
pub async fn plugin_auth_gate(host: State<'_, PluginHost>) -> Result<bool, String> {
    host.auth_gate().await
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
}
