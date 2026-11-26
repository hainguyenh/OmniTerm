//! Progress events of the clean-up dialogs (Clean Temp Files, Clean Up Sessions): a walk reports
//! after every entry from several threads, the webview gets at most one event per
//! [`EMIT_EVERY`] plus the last one, so a clean-up of thousands of entries never floods the IPC.

use app_core::temp_cleanup::Step;
use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};

const EMIT_EVERY: Duration = Duration::from_millis(120);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    phase: &'static str,
    done: u64,
    total: u64,
    bytes: u64,
}

/// Emits `event` with the walk's progress, throttled.
pub struct ProgressEmitter<R: Runtime> {
    app: AppHandle<R>,
    event: &'static str,
    phase: &'static str,
    last: Mutex<Option<Instant>>,
}

impl<R: Runtime> ProgressEmitter<R> {
    pub fn new(app: AppHandle<R>, event: &'static str, phase: &'static str) -> Self {
        Self {
            app,
            event,
            phase,
            last: Mutex::new(None),
        }
    }

    /// Emits `step` unless one went out less than [`EMIT_EVERY`] ago; the final step always goes.
    pub fn step(&self, step: Step) {
        let finished = step.done >= step.total;
        let Ok(mut last) = self.last.lock() else {
            return;
        };
        if !finished && last.is_some_and(|at| at.elapsed() < EMIT_EVERY) {
            return;
        }
        *last = Some(Instant::now());
        drop(last);
        let payload = ProgressEvent {
            phase: self.phase,
            done: step.done,
            total: step.total,
            bytes: step.bytes,
        };
        if let Err(error) = self.app.emit(self.event, payload) {
            log::debug!("[cleanup] progress event not sent: {error}");
        }
    }
}
