//! Native auto-update over GitHub Releases and CNB release endpoints via `tauri-plugin-updater`.

use crate::ide::requests::Requests;
use crate::update_coordinator::UpdatesCoordinator;
use crate::update_progress::{source_endpoints, ProgressThrottle, UpdateProgress};
use ide_core::updates::{UpdateCheck, UpdateInfo, UpdateSource, UpdateStatus};
use ide_core::{IdeError, IdeResult, RequestId};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_updater::UpdaterExt;

#[cfg(test)]
#[path = "update_manager_tests.rs"]
mod tests;

static INSTALLING: AtomicBool = AtomicBool::new(false);

pub struct InstallingGuard;

impl InstallingGuard {
    pub fn acquire() -> Option<Self> {
        (!INSTALLING.swap(true, Ordering::SeqCst)).then_some(Self)
    }

    #[cfg(test)]
    pub fn is_installing() -> bool {
        INSTALLING.load(Ordering::SeqCst)
    }
}

impl Drop for InstallingGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}

pub fn update_endpoint_env() -> Option<String> {
    std::env::var("OMNITERM_UPDATE_ENDPOINT")
        .or_else(|_| std::env::var("OMNITERM_UPDATE_ENDPOINT"))
        .ok()
        .filter(|s| !s.trim().is_empty())
}

/// Whether `lib.rs` registered the updater plugin. Asking the plugin itself is not an option:
/// `app.updater()` panics when the plugin was never registered (development builds).
pub struct UpdaterRegistered(pub bool);

pub fn updater_configured<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<UpdaterRegistered>().is_some_and(|registered| registered.0)
}

fn config_endpoints<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("endpoints"))
        .and_then(|e| e.as_array())
        .map(|e| e.iter().filter_map(|u| u.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn resolve_updater<R: Runtime>(
    app: &AppHandle<R>,
    source: UpdateSource,
) -> IdeResult<Option<tauri_plugin_updater::Updater>> {
    if !updater_configured(app) {
        return Ok(None);
    }
    let endpoints = source_endpoints(config_endpoints(app), source, update_endpoint_env());
    let endpoints = endpoints
        .iter()
        .map(|u| u.parse().map_err(|e| IdeError::invalid(format!("endpoint {u}: {e}"))))
        .collect::<IdeResult<Vec<_>>>()?;
    app.updater_builder()
        .endpoints(endpoints)
        .map_err(|e| IdeError::invalid(e.to_string()))?
        .build()
        .map(Some)
        .map_err(|e| IdeError::unavailable(e.to_string()))
}

#[tauri::command]
pub async fn app_check_update<R: Runtime>(
    app: AppHandle<R>,
    source: Option<UpdateSource>,
) -> IdeResult<UpdateCheck> {
    perform_check(&app, source).await
}

pub async fn perform_check<R: Runtime>(
    app: &AppHandle<R>,
    source: Option<UpdateSource>,
) -> IdeResult<UpdateCheck> {
    let source = source.unwrap_or_default();
    let Some(updater) = resolve_updater(app, source)? else {
        return Ok(UpdateCheck {
            enabled: false,
            update: None,
        });
    };
    let update = tokio::time::timeout(std::time::Duration::from_secs(60), updater.check())
        .await
        .map_err(|e| IdeError::unavailable(e.to_string()))?
        .map_err(|e| IdeError::unavailable(e.to_string()))?;
    Ok(UpdateCheck {
        enabled: true,
        update: update.map(|u| UpdateInfo {
            version: u.version.clone(),
            current_version: u.current_version.clone(),
            notes: u.body.clone(),
            date: u.date.map(|d| d.to_string()),
        }),
    })
}

#[tauri::command]
pub async fn app_install_update<R: Runtime>(
    app: AppHandle<R>,
    requests: State<'_, Requests>,
    source: Option<UpdateSource>,
    request: Option<RequestId>,
    on_progress: Channel<UpdateProgress>,
) -> IdeResult<()> {
    let _guard = InstallingGuard::acquire().ok_or_else(|| {
        IdeError::unavailable("InstallingGuard: Another update installation is already in progress")
    })?;
    let request_id = request.unwrap_or(RequestId(0));
    let token = requests.begin(request_id);
    let result = async {
        let updater = resolve_updater(&app, source.unwrap_or_default())?
            .ok_or_else(|| IdeError::unavailable("Native updates are disabled in this build."))?;
        let update = tokio::select! {
            r = updater.check() => r.map_err(|e| IdeError::unavailable(e.to_string()))?,
            _ = token.cancelled() => return Err(IdeError::cancelled()),
        }
        .ok_or_else(|| IdeError::not_found("no update available"))?;

        let mut throttle = ProgressThrottle::default();
        let progress = on_progress.clone();
        let download = update.download(
            move |len, total| {
                if let Some(p) = throttle.chunk(len, total) {
                    let _ = progress.send(p);
                }
            },
            || {},
        );
        let bytes = tokio::select! {
            r = download => r.map_err(|e| IdeError::unavailable(e.to_string()))?,
            _ = token.cancelled() => return Err(IdeError::cancelled()),
        };
        let _ = on_progress.send(UpdateProgress::Installing);
        tauri::async_runtime::spawn_blocking(move || update.install(bytes))
            .await
            .map_err(|e| IdeError::internal(e.to_string()))?
            .map_err(|e| IdeError::internal(e.to_string()))
    }
    .await;
    requests.end(request_id);
    result
}

#[tauri::command]
pub fn app_cancel_update(
    requests: State<'_, Requests>,
    token: Option<String>,
) -> IdeResult<Value> {
    if let Some(ref t) = token {
        if let Ok(id) = t.parse::<u32>() {
            requests.cancel(RequestId(id));
        }
    }
    Ok(json!({ "cancelled": true, "token": token }))
}

#[tauri::command]
pub fn app_update_window_ready<R: Runtime>(
    app: AppHandle<R>,
    coordinator: State<'_, UpdatesCoordinator>,
    window: tauri::WebviewWindow<R>,
    ready: bool,
    system_locale: String,
) -> IdeResult<()> {
    coordinator.window_ready(&app, window.label(), ready, system_locale);
    Ok(())
}

#[tauri::command]
pub fn app_update_status(coordinator: State<'_, UpdatesCoordinator>) -> IdeResult<UpdateStatus> {
    Ok(coordinator
        .state
        .lock()
        .map(|s| s.policy.status.clone())
        .unwrap_or_default())
}

#[tauri::command]
pub fn app_update_announcement(
    coordinator: State<'_, UpdatesCoordinator>,
    version: String,
    automatic: bool,
) -> IdeResult<bool> {
    let claimed = coordinator
        .state
        .lock()
        .map(|mut s| s.policy.announce(&version))
        .unwrap_or(false);
    Ok(!automatic || claimed)
}

#[tauri::command]
pub fn app_restart<R: Runtime>(app: AppHandle<R>) -> Value {
    app.request_restart();
    json!({ "restarting": true })
}

#[tauri::command]
pub async fn check_for_native_update<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    if !updater_configured(&app) {
        return Ok(json!({ "available": false, "reason": "updater-disabled" }));
    }
    match app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
    {
        Some(u) => Ok(json!({
            "available": true,
            "version": u.version,
            "notes": u.body.unwrap_or_default(),
        })),
        None => Ok(json!({ "available": false, "reason": "up-to-date" })),
    }
}

#[tauri::command]
pub async fn download_and_install_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let _guard = InstallingGuard::acquire().ok_or_else(|| {
        "InstallingGuard: Another update installation is already in progress".to_string()
    })?;
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
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}
