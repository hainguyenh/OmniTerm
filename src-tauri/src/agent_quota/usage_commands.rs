//! The Agent Quota commands that read quota, wake profiles and list them. Thin: the logic lives in
//! `app_core::agent_quota`; this checks the feature is switched on, validates the request at the
//! IPC boundary and runs the blocking work off the async runtime.

use std::path::PathBuf;
use std::sync::OnceLock;

use app_core::agent_quota::{
    parse_fetch_request, parse_wake_request, BridgeTarget, DiscoveredProfile, Platform,
    QuotaService, QuotaSnapshot, SystemDeps, WakeResult,
};
use app_core::agent_session_index::{purge_probe_sessions, session_roots};
use app_core::builtin_features::AGENT_QUOTA;
use serde_json::Value;
use tauri::{AppHandle, Runtime};

fn home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// One service for the app's life, so concurrent probes of a profile share one CLI run.
fn service() -> &'static QuotaService<SystemDeps> {
    static SERVICE: OnceLock<QuotaService<SystemDeps>> = OnceLock::new();
    SERVICE.get_or_init(|| {
        QuotaService::new(SystemDeps::new(
            home_dir(),
            Box::new(|message| log::info!("{message}")),
        ))
    })
}

fn ensure_enabled<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if crate::builtin_features::is_enabled(app, AGENT_QUOTA) {
        Ok(())
    } else {
        Err("Agent Quota is turned off in Plugins.".to_string())
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("Agent Quota task failed: {error}"))
}

/// Whether the built-in feature is switched on; the renderer runs the quota engine only then.
#[tauri::command]
pub async fn agent_quota_info<R: Runtime>(app: AppHandle<R>) -> bool {
    crate::builtin_features::is_enabled(&app, AGENT_QUOTA)
}

#[tauri::command]
pub async fn agent_quota_fetch_usage<R: Runtime>(
    app: AppHandle<R>,
    request: Value,
) -> Result<QuotaSnapshot, String> {
    ensure_enabled(&app)?;
    let request = parse_fetch_request(&request)?;
    blocking(move || service().fetch_usage(&request)).await
}

/// Whether the profile reports its quota by itself (a status line bridge, installed here when
/// missing, or Codex's session log); when it does, the renderer skips the inline pane probe.
#[tauri::command]
pub async fn agent_quota_ensure_passive<R: Runtime>(
    app: AppHandle<R>,
    request: Value,
) -> Result<bool, String> {
    ensure_enabled(&app)?;
    let request = parse_fetch_request(&request)?;
    let exe = super::bridge_commands::exe()?;
    let settings = super::bridge_commands::app_settings(&app)?;
    blocking(move || {
        let target = BridgeTarget {
            exe: &exe,
            app_settings: &settings,
            platform: Platform::CURRENT,
        };
        service().ensure_passive_source(&request, &target)
    })
    .await
}

#[tauri::command]
pub async fn agent_quota_wake<R: Runtime>(
    app: AppHandle<R>,
    request: Value,
) -> Result<WakeResult, String> {
    ensure_enabled(&app)?;
    let request = parse_wake_request(&request)?;
    blocking(move || service().wake(&request)).await
}

#[tauri::command]
pub async fn agent_quota_list_profiles<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<DiscoveredProfile>, String> {
    ensure_enabled(&app)?;
    blocking(|| service().list_profiles()).await
}

/// A probe of the previous round has long exited by then; one still running is never touched.
const PROBE_LEFTOVER_IDLE_MS: u64 = 5 * 60 * 1000;

/// Each probe run leaves Claude a transcript with no prompt in the scratch folder, which its resume
/// list shows as an empty session. The previous rounds' are removed in the background.
fn purge_probe_leftovers(scratch: &std::path::Path) {
    let Some(name) = scratch
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
    else {
        return;
    };
    tauri::async_runtime::spawn_blocking(move || {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| {
                u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
            });
        let removed = purge_probe_sessions(
            &session_roots(&home_dir()),
            &name,
            PROBE_LEFTOVER_IDLE_MS,
            now,
        );
        if removed > 0 {
            log::info!("[agent-quota] removed {removed} empty probe session(s)");
        }
    });
}

/// The scratch folder the renderer's hidden profile probe starts agents in.
#[tauri::command]
pub async fn agent_quota_probe_dir<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    ensure_enabled(&app)?;
    let scratch = service().probe_dir();
    purge_probe_leftovers(scratch);
    Ok(scratch.to_string_lossy().into_owned())
}

#[cfg(test)]
#[path = "usage_commands_tests.rs"]
mod tests;
