//! Always Awake state, scheduling, activity aggregation, and native keep-awake behavior.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[path = "native.rs"]
mod native;

const TICK: Duration = Duration::from_millis(500);
const JIGGLE_MIN_INTERVAL_MS: i64 = 30_000;
const SLEEP_TIMEOUT_CACHE_MS: i64 = 60_000;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AwakeMode {
    Always,
    #[default]
    ActiveOnly,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct StoredState {
    enabled: bool,
    mode: AwakeMode,
    expires_at_ms: i64,
}

impl Default for StoredState {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: AwakeMode::ActiveOnly,
            expires_at_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwakeStatus {
    pub enabled: bool,
    pub mode: AwakeMode,
    pub expires_at_ms: i64,
    pub active_session_count: usize,
    pub keeping_awake: bool,
    pub supported: bool,
    pub error: Option<String>,
}

pub struct AlwaysAwakeState {
    stored: Mutex<StoredState>,
    initialized: AtomicBool,
    native_asserted: AtomicBool,
    last_error: Mutex<Option<String>>,
    last_jiggle_ms: Mutex<i64>,
    sleep_timeout: Mutex<Option<(i64, Option<u64>)>>,
}

impl AlwaysAwakeState {
    pub fn new() -> Self {
        Self {
            stored: Mutex::new(StoredState::default()),
            initialized: AtomicBool::new(false),
            native_asserted: AtomicBool::new(false),
            last_error: Mutex::new(None),
            last_jiggle_ms: Mutex::new(0),
            sleep_timeout: Mutex::new(None),
        }
    }
}

impl Default for AlwaysAwakeState {
    fn default() -> Self {
        Self::new()
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
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

fn session_is_active(session: &crate::pty::PtySession, table: &crate::proc_activity::ProcTable) -> bool {
    // SSH is intentionally conservative: Windows OpenSSH exposes the transport process but not
    // whether the remote shell is at a prompt, so any connected SSH PTY counts as active.
    session.ssh
        || session.launched_with_command
        || session.pid.is_some_and(|pid| table.has_descendant(pid))
}

fn active_session_count(
    manager: &crate::pty::PtyManager,
    table: &crate::proc_activity::ProcTable,
) -> usize {
    manager
        .sessions
        .iter()
        .filter(|entry| session_is_active(entry.value(), table))
        .count()
}

fn should_keep_awake(stored: &StoredState, active_count: usize) -> bool {
    stored.enabled
        && (stored.mode == AwakeMode::Always || active_count > 0)
        && cfg!(windows)
}

fn is_expired(stored: &StoredState, now: i64) -> bool {
    stored.enabled && stored.expires_at_ms > 0 && stored.expires_at_ms <= now
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

fn emit_status<R: Runtime>(app: &AppHandle<R>, state: &AlwaysAwakeState, active_count: usize) {
    if let Ok(value) = status(app, state, active_count) {
        let _ = app.emit("always-awake:state", value);
    }
}

fn reconcile<R: Runtime>(
    app: &AppHandle<R>,
    state: &AlwaysAwakeState,
    table: &crate::proc_activity::ProcTable,
) {
    let Some(manager) = app.try_state::<crate::pty::PtyManager>() else {
        return;
    };
    let active_count = active_session_count(&manager, table);
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

pub fn spawn_poller<R: Runtime>(app: AppHandle<R>) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let Some(state) = app.try_state::<AlwaysAwakeState>() else {
            return;
        };
        let _ = load_state(&app, &state);
        let mut system = System::new();
        let mut ticker = tokio::time::interval(TICK);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            let Some(manager) = app.try_state::<crate::pty::PtyManager>() else {
                return;
            };
            if manager.sessions.is_empty() {
                let table = crate::proc_activity::ProcTable::default();
                reconcile(&app, &state, &table);
                continue;
            }
            let table = crate::proc_activity::ProcTable::snapshot(&mut system);
            reconcile(&app, &state, &table);
        }
    })
}

#[tauri::command]
pub async fn get_state<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AlwaysAwakeState>,
) -> Result<AwakeStatus, String> {
    load_state(&app, &state)?;
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
mod tests {
    use super::*;

    #[test]
    fn active_only_waits_for_activity() {
        let stored = StoredState {
            enabled: true,
            mode: AwakeMode::ActiveOnly,
            expires_at_ms: 100,
        };
        assert!(!should_keep_awake(&stored, 0));
        assert_eq!(should_keep_awake(&stored, 1), cfg!(windows));
    }

    #[test]
    fn always_mode_does_not_require_a_session() {
        let stored = StoredState {
            enabled: true,
            mode: AwakeMode::Always,
            expires_at_ms: 100,
        };
        assert_eq!(should_keep_awake(&stored, 0), cfg!(windows));
    }

    #[test]
    fn expiry_is_inclusive() {
        let stored = StoredState {
            enabled: true,
            mode: AwakeMode::Always,
            expires_at_ms: 100,
        };
        assert!(!is_expired(&stored, 99));
        assert!(is_expired(&stored, 100));
        assert!(is_expired(&stored, 101));
    }

    #[test]
    fn mode_wire_names_are_stable() {
        assert_eq!(serde_json::to_string(&AwakeMode::ActiveOnly).unwrap(), "\"activeOnly\"");
        assert_eq!(serde_json::to_string(&AwakeMode::Always).unwrap(), "\"always\"");
    }

    #[cfg(windows)]
    #[test]
    fn windows_sleep_assertion_round_trips() {
        native::apply_assertion(true).expect("Windows should accept sleep prevention");
        native::apply_assertion(false).expect("Windows should clear sleep prevention");
    }
}
