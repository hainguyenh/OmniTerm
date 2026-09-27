//! Plugin host IPC commands.

use crate::plugin_host::PluginHost;
use tauri::State;

#[tauri::command]
pub async fn plugin_available<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    host: State<'_, PluginHost>,
) -> Result<bool, String> {
    host.start(&app).await?;
    Ok(host.is_available().await)
}

#[tauri::command]
pub async fn plugin_list<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    host: State<'_, PluginHost>,
) -> Result<Vec<serde_json::Value>, String> {
    host.start(&app).await?;
    host.list_plugins().await
}

#[tauri::command]
pub async fn plugin_set_enabled(
    host: State<'_, PluginHost>,
    id: String,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    host.set_enabled(id, enabled).await
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
