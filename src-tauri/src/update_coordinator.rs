//! Background coordinator for application update checks, window readiness, and announcement deduplication.

use crate::ide::events::TauriSink;
use ide_core::event::EventSink;
use ide_core::updates::{UpdatePolicy, UpdateSource};
use ide_core::IdeEvent;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::Notify;

#[derive(Default)]
pub struct UpdatesCoordinator {
    started: AtomicBool,
    ready: Mutex<HashSet<String>>,
    system_locale: Mutex<String>,
    pub wake: Notify,
    pub state: Mutex<CheckState>,
}

#[derive(Default)]
pub struct CheckState {
    pub policy: UpdatePolicy,
}

impl UpdatesCoordinator {
    pub fn window_ready<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        window: &str,
        ready: bool,
        system_locale: String,
    ) {
        if !ready {
            if let Ok(mut set) = self.ready.lock() {
                set.remove(window);
            }
            return;
        }
        if let Ok(mut set) = self.ready.lock() {
            set.insert(window.to_owned());
        }
        if let Ok(mut loc) = self.system_locale.lock() {
            *loc = system_locale;
        }
        if !crate::update_manager::updater_configured(app) {
            return;
        }
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let coord = app.state::<UpdatesCoordinator>();
                let wake = coord.wake.notified();
                let delay = coord
                    .state
                    .lock()
                    .map(|s| s.policy.due_in(Instant::now()))
                    .unwrap_or_default();
                if delay.is_zero() {
                    coord.check_once(&app).await;
                    continue;
                }
                tokio::select! {
                    _ = tokio::time::sleep(delay) => {},
                    _ = wake => {},
                }
            }
        });
    }

    pub async fn check_once<R: Runtime>(&self, app: &AppHandle<R>) {
        let now = Instant::now();
        if let Ok(mut state) = self.state.lock() {
            state.policy.begin(now);
        }
        self.emit_status(app);
        let source = UpdateSource::resolve("auto", "", &self.system_locale());
        let res = crate::update_manager::perform_check(app, Some(source)).await;
        let check_success = res.is_ok();
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as f64)
            .ok();
        if let Ok(mut state) = self.state.lock() {
            state.policy.finish(if check_success { now_ms } else { None });
        }
        self.emit_status(app);
        if let Ok(check) = res {
            if let Some(update) = check.update {
                let should_announce = self
                    .state
                    .lock()
                    .map(|mut s| s.policy.announce(&update.version))
                    .unwrap_or(false);
                if should_announce {
                    self.emit_available(app, update);
                }
            }
        }
    }

    pub fn system_locale(&self) -> String {
        self.system_locale
            .lock()
            .map(|l| l.clone())
            .unwrap_or_default()
    }

    pub fn emit_status<R: Runtime>(&self, app: &AppHandle<R>) {
        if let Ok(state) = self.state.lock() {
            let status = state.policy.status.clone();
            TauriSink::new(app.clone()).emit(IdeEvent::UpdateStatusChanged { status });
        }
    }

    pub fn emit_available<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        update: ide_core::updates::UpdateInfo,
    ) {
        TauriSink::new(app.clone()).emit(IdeEvent::UpdateAvailable { update });
    }
}
