//! Always Awake runtime: persistence, the poller, and the three commands the plugin invokes.
//!
//! The decisions this applies — what counts as an active session, when a schedule has expired,
//! whether the machine should be held awake — live in `awake_schedule.rs`.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[path = "native.rs"]
mod native;
#[path = "awake_schedule.rs"]
mod awake_schedule;
#[path = "awake_poller.rs"]
mod awake_poller;

pub use awake_schedule::{AwakeMode, AwakeStatus, AwakeTarget};
use awake_schedule::{active_session_count, is_expired, now_ms, should_keep_awake, StoredState};
pub use awake_poller::spawn_poller;
use awake_poller::ensure_poller;

const TICK: Duration = Duration::from_millis(500);
const JIGGLE_MIN_INTERVAL_MS: i64 = 30_000;
const SLEEP_TIMEOUT_CACHE_MS: i64 = 60_000;

pub struct AlwaysAwakeState {
    stored: Mutex<StoredState>,
    initialized: AtomicBool,
    native_asserted: AtomicBool,
    last_error: Mutex<Option<String>>,
    last_jiggle_ms: Mutex<i64>,
    sleep_timeout: Mutex<Option<(i64, Option<u64>)>>,
    /// Set once `ensure_poller` has spawned the loop, so repeated `get_state` calls do not stack
    /// pollers.
    poller_started: AtomicBool,
    /// The last status pushed to the frontend, so a tick that changed nothing stays silent.
    last_emitted: Mutex<Option<EmittedKey>>,
    /// Set from the app's exit event; the poller hands the sleep request back and stops.
    shutting_down: AtomicBool,
}

/// Everything about a status the frontend can see: enabled, mode, deadline, active session count,
/// whether the machine is actually being held awake, and the last error.
type EmittedKey = (bool, AwakeMode, i64, usize, bool, Option<String>);

impl AlwaysAwakeState {
    pub fn new() -> Self {
        Self {
            stored: Mutex::new(StoredState::default()),
            initialized: AtomicBool::new(false),
            native_asserted: AtomicBool::new(false),
            last_error: Mutex::new(None),
            last_jiggle_ms: Mutex::new(0),
            sleep_timeout: Mutex::new(None),
            poller_started: AtomicBool::new(false),
            last_emitted: Mutex::new(None),
            shutting_down: AtomicBool::new(false),
        }
    }

    /// Stop keeping the machine awake and end the poller.
    ///
    /// Called from the app's exit event. Waiting for the process to die would work on Windows — the
    /// kernel drops a dead process's execution state — but only the poller thread can hand the
    /// request back deliberately, so it is asked to before the app goes.
    pub fn begin_shutdown(&self) {
        self.shutting_down.store(true, Ordering::Release);
    }
}

impl Default for AlwaysAwakeState {
    fn default() -> Self {
        Self::new()
    }
}

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data directory: {e}"))?
        .join("always-awake.json"))
}

fn load_state<R: Runtime>(app: &AppHandle<R>, state: &AlwaysAwakeState) -> Result<(), String> {
    if state.initialized.load(Ordering::Acquire) {
        return Ok(());
    }
    let loaded = state_path(app)
        .ok()
        .filter(|path| path.exists())
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<StoredState>(&text).ok())
        .unwrap_or_default();
    *state
        .stored
        .lock()
        .map_err(|_| "Always Awake state lock is poisoned".to_string())? = loaded;
    state.initialized.store(true, Ordering::Release);
    Ok(())
}

fn save_state<R: Runtime>(app: &AppHandle<R>, stored: &StoredState) -> Result<(), String> {
    let path = state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create app data directory: {e}"))?;
    }
    let text = serde_json::to_string_pretty(stored).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| format!("Could not save Always Awake state: {e}"))
}

fn set_error(state: &AlwaysAwakeState, error: Option<String>) {
    if let Ok(mut current) = state.last_error.lock() {
        *current = error;
    }
}

fn awake_targets(manager: &crate::pty::PtyManager) -> Vec<AwakeTarget> {
    manager
        .sessions
        .iter()
        .map(|entry| AwakeTarget {
            ssh: entry.ssh,
            launched_with_command: entry.launched_with_command,
            pid: entry.pid,
        })
        .collect()
}

fn cached_sleep_timeout(state: &AlwaysAwakeState) -> Result<Option<u64>, String> {
    let now = now_ms();
    if let Ok(cache) = state.sleep_timeout.lock() {
        if let Some((at, value)) = *cache {
            if now - at < SLEEP_TIMEOUT_CACHE_MS {
                return Ok(value);
            }
        }
    }
    let value = native::sleep_timeout_seconds()?;
    if let Ok(mut cache) = state.sleep_timeout.lock() {
        *cache = Some((now, value));
    }
    Ok(value)
}

fn status<R: Runtime>(
    _app: &AppHandle<R>,
    state: &AlwaysAwakeState,
    active_count: usize,
) -> Result<AwakeStatus, String> {
    let stored = state
        .stored
        .lock()
        .map_err(|_| "Always Awake state lock is poisoned".to_string())?
        .clone();
    let error = state
        .last_error
        .lock()
        .map_err(|_| "Always Awake error lock is poisoned".to_string())?
        .clone();
    Ok(AwakeStatus {
        enabled: stored.enabled,
        mode: stored.mode,
        expires_at_ms: stored.expires_at_ms,
        active_session_count: active_count,
        keeping_awake: state.native_asserted.load(Ordering::Acquire),
        supported: cfg!(windows),
        error,
    })
}

fn emitted_key(value: &AwakeStatus) -> EmittedKey {
    (
        value.enabled,
        value.mode,
        value.expires_at_ms,
        value.active_session_count,
        value.keeping_awake,
        value.error.clone(),
    )
}

/// Push a status to the frontend, but only when it differs from the last one sent.
///
/// The poller ticks twice a second for the life of the app. Emitting unconditionally meant two IPC
/// messages and two React renders per second forever, including on a machine where Always Awake was
/// never switched on.
fn emit_status<R: Runtime>(app: &AppHandle<R>, state: &AlwaysAwakeState, active_count: usize) {
    let Ok(value) = status(app, state, active_count) else {
        return;
    };
    let key = emitted_key(&value);
    // A poisoned lock must not silence the feature: `if let` skips the check and emits, which is the
    // safe way to be wrong here.
    if let Ok(mut last) = state.last_emitted.lock() {
        if last.as_ref() == Some(&key) {
            return;
        }
        *last = Some(key);
    }
    let _ = app.emit("always-awake:state", value);
}

fn reconcile<R: Runtime>(
    app: &AppHandle<R>,
    state: &AlwaysAwakeState,
    table: &crate::proc_activity::ProcTable,
) {
    let Some(manager) = app.try_state::<crate::pty::PtyManager>() else {
        return;
    };
    let active_count = active_session_count(&awake_targets(&manager), table);
    let mut stored = match state.stored.lock() {
        Ok(value) => value,
        Err(_) => return,
    };
    if is_expired(&stored, now_ms()) {
        stored.enabled = false;
        let snapshot = stored.clone();
        drop(stored);
        let _ = save_state(app, &snapshot);
        stored = match state.stored.lock() {
            Ok(value) => value,
            Err(_) => return,
        };
    }
    let should_assert = should_keep_awake(&stored, active_count);
    drop(stored);

    let currently_asserted = state.native_asserted.load(Ordering::Acquire);
    if should_assert != currently_asserted {
        match native::apply_assertion(should_assert) {
            Ok(()) => {
                state.native_asserted.store(should_assert, Ordering::Release);
                set_error(state, None);
            }
            Err(error) => set_error(state, Some(error)),
        }
    }

    if should_assert {
        if let (Ok(Some(timeout)), Ok(idle)) = (cached_sleep_timeout(state), native::idle_seconds()) {
            if idle >= timeout / 2 {
                let now = now_ms();
                let should_jiggle = state
                    .last_jiggle_ms
                    .lock()
                    .map(|last| now - *last >= JIGGLE_MIN_INTERVAL_MS)
                    .unwrap_or(false);
                if should_jiggle {
                    match native::jiggle_mouse() {
                        Ok(()) => {
                            if let Ok(mut last) = state.last_jiggle_ms.lock() {
                                *last = now;
                            }
                        }
                        Err(error) => set_error(state, Some(error)),
                    }
                }
            }
        }
    }
    emit_status(app, state, active_count);
}

#[tauri::command]
pub async fn get_state<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AlwaysAwakeState>,
) -> Result<AwakeStatus, String> {
    load_state(&app, &state)?;
    ensure_poller(&app, &state);
    status(&app, &state, 0)
}

#[tauri::command]
pub async fn set_state<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AlwaysAwakeState>,
    enabled: bool,
    mode: AwakeMode,
    expires_at_ms: i64,
) -> Result<AwakeStatus, String> {
    load_state(&app, &state)?;
    if enabled && expires_at_ms <= now_ms() {
        return Err("Always Awake expiry must be in the future.".to_string());
    }
    if enabled && !cfg!(windows) {
        return Err("Always Awake is currently supported on Windows only.".to_string());
    }
    let next = StoredState {
        enabled,
        mode,
        expires_at_ms: if enabled { expires_at_ms } else { 0 },
    };
    save_state(&app, &next)?;
    *state
        .stored
        .lock()
        .map_err(|_| "Always Awake state lock is poisoned".to_string())? = next;
    emit_status(&app, &state, 0);
    status(&app, &state, 0)
}

#[tauri::command]
pub async fn disable<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AlwaysAwakeState>,
) -> Result<AwakeStatus, String> {
    set_state(app, state, false, AwakeMode::ActiveOnly, 0).await
}

#[cfg(test)]
#[path = "always_awake_tests.rs"]
mod tests;

