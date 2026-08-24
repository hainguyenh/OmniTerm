//! Always Awake: the activity rule, the schedule rule, persistence, and the three commands.
//!
//! The pure rules run without a runtime. Everything that touches app-data or emits an event goes
//! through `tauri::test`'s mock app, because path resolution, state lookup and persistence are
//! exactly where this module has failed before — a helper test would not see any of it.

use super::*;
use crate::proc_activity::ProcTable;
use crate::pty::PtyManager;
use crate::test_support;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, MutexGuard};
use tauri::test::MockRuntime;
use tauri::Listener;

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────

/// A mock app carrying the managed state the module expects, on its own app-data directory.
struct Fixture {
    _guard: MutexGuard<'static, ()>,
    app: tauri::App<MockRuntime>,
    data_dir: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let guard = test_support::lock();
        let app = test_support::mock_app();
        assert!(app.manage(AlwaysAwakeState::new()));
        let data_dir = app.path().app_data_dir().expect("mock app data directory");
        let _ = fs::remove_dir_all(&data_dir);
        Self {
            _guard: guard,
            app,
            data_dir,
        }
    }

    fn handle(&self) -> AppHandle<MockRuntime> {
        self.app.handle().clone()
    }

    fn state(&self) -> tauri::State<'_, AlwaysAwakeState> {
        self.app.state::<AlwaysAwakeState>()
    }

    fn state_file(&self) -> PathBuf {
        self.data_dir.join("always-awake.json")
    }

    fn write_state_file(&self, contents: &str) {
        fs::create_dir_all(&self.data_dir).expect("create mock app data directory");
        fs::write(self.state_file(), contents).expect("write stored state");
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.data_dir);
    }
}

fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

fn stored(enabled: bool, mode: AwakeMode, expires_at_ms: i64) -> StoredState {
    StoredState {
        enabled,
        mode,
        expires_at_ms,
    }
}

/// A shell (pid 100) with one child, so `has_descendant(100)` is true and `has_descendant(200)` is
/// not — pid 200 is a shell sitting at its prompt.
fn table() -> ProcTable {
    ProcTable::from_rows([
        (100u32, 1u32, 10u64, "pwsh.exe"),
        (101, 100, 20, "ping.exe"),
        (200, 1, 30, "pwsh.exe"),
    ])
}

// ── session targets ─────────────────────────────────────────────────────────────────────

#[test]
fn targets_are_copied_out_of_an_empty_manager_without_holding_a_guard() {
    assert!(awake_targets(&PtyManager::new()).is_empty());
}

// ── in-memory state ────────────────────────────────────────────────────────────────────────────

#[test]
fn a_fresh_state_is_uninitialized_and_error_free() {
    let state = AlwaysAwakeState::default();
    assert!(!state.initialized.load(Ordering::Acquire));
    assert!(!state.native_asserted.load(Ordering::Acquire));
    assert!(state.last_error.lock().unwrap().is_none());
    assert_eq!(*state.last_jiggle_ms.lock().unwrap(), 0);
    assert!(state.sleep_timeout.lock().unwrap().is_none());
    assert!(!state.poller_started.load(Ordering::Acquire));
    assert!(state.last_emitted.lock().unwrap().is_none());
}

#[test]
fn the_last_error_can_be_set_and_cleared() {
    let state = AlwaysAwakeState::new();
    set_error(&state, Some("boom".to_string()));
    assert_eq!(state.last_error.lock().unwrap().as_deref(), Some("boom"));
    set_error(&state, None);
    assert!(state.last_error.lock().unwrap().is_none());
}

#[test]
fn a_fresh_sleep_timeout_read_is_cached_and_a_stale_one_is_not() {
    let state = AlwaysAwakeState::new();
    *state.sleep_timeout.lock().unwrap() = Some((now_ms(), Some(1800)));
    assert_eq!(cached_sleep_timeout(&state).expect("cache hit"), Some(1800));

    // Older than the cache window, so the value is re-read from the platform rather than reused.
    *state.sleep_timeout.lock().unwrap() =
        Some((now_ms() - SLEEP_TIMEOUT_CACHE_MS - 1, Some(1800)));
    let refreshed = cached_sleep_timeout(&state);
    assert_eq!(refreshed.is_ok(), cfg!(windows));
}

// ── persistence ────────────────────────────────────────────────────────────────────────────────

#[test]
fn the_state_file_sits_in_the_app_data_directory() {
    let fixture = Fixture::new();
    assert_eq!(
        state_path(&fixture.handle()).expect("resolve state path"),
        fixture.state_file()
    );
}

#[test]
fn a_missing_state_file_loads_the_default_and_marks_the_state_initialized() {
    let fixture = Fixture::new();
    let state = fixture.state();
    load_state(&fixture.handle(), &state).expect("load a missing state file");
    assert!(state.initialized.load(Ordering::Acquire));
    assert!(!state.stored.lock().unwrap().enabled);
}

#[test]
fn a_corrupt_state_file_loads_the_default_instead_of_failing() {
    let fixture = Fixture::new();
    fixture.write_state_file("{ not json");
    let state = fixture.state();
    load_state(&fixture.handle(), &state).expect("a corrupt file is not an error");
    assert_eq!(*state.stored.lock().unwrap(), StoredState::default());
}

#[test]
fn a_saved_schedule_is_read_back() {
    let fixture = Fixture::new();
    let saved = stored(true, AwakeMode::Always, 4_102_444_800_000);
    save_state(&fixture.handle(), &saved).expect("save creates the app data directory");
    assert!(fixture.state_file().exists());

    let state = fixture.state();
    load_state(&fixture.handle(), &state).expect("load the saved state");
    assert_eq!(*state.stored.lock().unwrap(), saved);
}

#[test]
fn load_is_a_no_op_once_the_state_is_initialized() {
    // The poller calls `load_state` on every command; re-reading would discard an in-memory change
    // that has not been flushed yet.
    let fixture = Fixture::new();
    let state = fixture.state();
    state.initialized.store(true, Ordering::Release);
    fixture.write_state_file(r#"{"enabled":true,"mode":"always","expires_at_ms":1}"#);
    load_state(&fixture.handle(), &state).expect("load short-circuits");
    assert!(!state.stored.lock().unwrap().enabled);
}

// ── status and events ──────────────────────────────────────────────────────────────────────────

#[test]
fn status_reports_the_stored_schedule_the_active_count_and_the_last_error() {
    let fixture = Fixture::new();
    let state = fixture.state();
    *state.stored.lock().unwrap() = stored(true, AwakeMode::Always, 42);
    state.native_asserted.store(true, Ordering::Release);
    set_error(&state, Some("nope".to_string()));

    let status = status(&fixture.handle(), &state, 3).expect("build a status");
    assert!(status.enabled);
    assert_eq!(status.mode, AwakeMode::Always);
    assert_eq!(status.expires_at_ms, 42);
    assert_eq!(status.active_session_count, 3);
    assert!(status.keeping_awake);
    assert_eq!(status.supported, cfg!(windows));
    assert_eq!(status.error.as_deref(), Some("nope"));
}

#[test]
fn an_unchanged_tick_emits_nothing() {
    // The poller ticks twice a second forever; without this the frontend would re-render at 2 Hz on a
    // machine that never switched Always Awake on.
    let fixture = Fixture::new();
    let seen = Arc::new(Mutex::new(0usize));
    let sink = Arc::clone(&seen);
    fixture.app.listen("always-awake:state", move |_| {
        *sink.lock().unwrap() += 1;
    });

    emit_status(&fixture.handle(), &fixture.state(), 0);
    emit_status(&fixture.handle(), &fixture.state(), 0);
    assert_eq!(
        *seen.lock().unwrap(),
        1,
        "the second identical status is dropped"
    );

    emit_status(&fixture.handle(), &fixture.state(), 1);
    assert_eq!(*seen.lock().unwrap(), 2, "a changed active count is sent");

    set_error(&fixture.state(), Some("boom".to_string()));
    emit_status(&fixture.handle(), &fixture.state(), 1);
    assert_eq!(*seen.lock().unwrap(), 3, "a new error is sent");
}

#[test]
fn the_poller_starts_once_and_only_when_the_plugin_asks() {
    let fixture = Fixture::new();
    let state = fixture.state();
    assert!(
        !state.poller_started.load(Ordering::Acquire),
        "managing the state must not start polling — a build without the plugin never calls get_state"
    );

    ensure_poller(&fixture.handle(), &state);
    assert!(state.poller_started.load(Ordering::Acquire));
    // A second call must not stack a second loop on top of the first.
    ensure_poller(&fixture.handle(), &state);
    assert!(state.poller_started.load(Ordering::Acquire));
}

#[test]
fn get_state_is_what_starts_the_poller() {
    let fixture = Fixture::new();
    block_on(get_state(fixture.handle(), fixture.state())).expect("get_state");
    assert!(fixture.state().poller_started.load(Ordering::Acquire));
}

#[test]
fn emitting_a_status_reaches_a_listener() {
    let fixture = Fixture::new();
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = Arc::clone(&seen);
    fixture.app.listen("always-awake:state", move |event| {
        sink.lock().unwrap().push(event.payload().to_string());
    });

    emit_status(&fixture.handle(), &fixture.state(), 2);
    let payloads = seen.lock().unwrap();
    assert_eq!(payloads.len(), 1, "exactly one state event per emit");
    assert!(
        payloads[0].contains("\"activeSessionCount\":2"),
        "payload uses the camelCase wire shape: {}",
        payloads[0]
    );
}

// ── reconcile ──────────────────────────────────────────────────────────────────────────────────

#[test]
fn reconcile_does_nothing_without_a_pty_manager() {
    // Shutdown order is not guaranteed; the poller can tick after the manager is gone.
    let fixture = Fixture::new();
    reconcile(&fixture.handle(), &fixture.state(), &table());
    assert!(!fixture.state().native_asserted.load(Ordering::Acquire));
}

#[test]
fn reconcile_disables_and_persists_an_expired_schedule() {
    let fixture = Fixture::new();
    assert!(fixture.app.manage(PtyManager::new()));
    let state = fixture.state();
    *state.stored.lock().unwrap() = stored(true, AwakeMode::Always, 1);

    reconcile(&fixture.handle(), &state, &table());

    assert!(
        !state.stored.lock().unwrap().enabled,
        "an expired schedule turns itself off"
    );
    let persisted = fs::read_to_string(fixture.state_file()).expect("expiry is written to disk");
    assert!(
        persisted.contains("\"enabled\": false"),
        "the disabled schedule must survive a restart: {persisted}"
    );
}

#[test]
fn reconcile_leaves_a_live_schedule_alone() {
    let fixture = Fixture::new();
    assert!(fixture.app.manage(PtyManager::new()));
    let state = fixture.state();
    let live = stored(true, AwakeMode::ActiveOnly, i64::MAX);
    *state.stored.lock().unwrap() = live.clone();

    reconcile(&fixture.handle(), &state, &table());

    assert_eq!(*state.stored.lock().unwrap(), live);
}

// ── commands ───────────────────────────────────────────────────────────────────────────────────

#[test]
fn get_state_loads_from_disk_on_the_first_call() {
    let fixture = Fixture::new();
    fixture.write_state_file(r#"{"enabled":true,"mode":"always","expires_at_ms":4102444800000}"#);

    let status = block_on(get_state(fixture.handle(), fixture.state())).expect("get_state");
    assert!(status.enabled);
    assert_eq!(status.mode, AwakeMode::Always);
    assert_eq!(status.expires_at_ms, 4_102_444_800_000);
}

#[test]
fn set_state_rejects_an_expiry_that_has_already_passed() {
    let fixture = Fixture::new();
    let error = block_on(set_state(
        fixture.handle(),
        fixture.state(),
        true,
        AwakeMode::Always,
        1,
    ))
    .expect_err("a past expiry is not a schedule");
    assert!(error.contains("future"), "unexpected message: {error}");
    assert!(
        !fixture.state_file().exists(),
        "a rejected schedule is not persisted"
    );
}

#[test]
fn enabling_reports_the_platform_it_needs() {
    let fixture = Fixture::new();
    let result = block_on(set_state(
        fixture.handle(),
        fixture.state(),
        true,
        AwakeMode::Always,
        4_102_444_800_000,
    ));
    if cfg!(windows) {
        let status = result.expect("Windows accepts a future schedule");
        assert!(status.enabled);
        assert_eq!(status.expires_at_ms, 4_102_444_800_000);
        assert!(
            fixture.state_file().exists(),
            "an accepted schedule is persisted"
        );
    } else {
        let error = result.expect_err("Always Awake is Windows-only");
        assert!(error.contains("Windows"), "unexpected message: {error}");
    }
}

#[test]
fn disabling_clears_the_deadline_and_is_allowed_on_every_platform() {
    let fixture = Fixture::new();
    let state = fixture.state();
    *state.stored.lock().unwrap() = stored(true, AwakeMode::Always, i64::MAX);
    state.initialized.store(true, Ordering::Release);

    let status = block_on(disable(fixture.handle(), fixture.state())).expect("disable");
    assert!(!status.enabled);
    assert_eq!(
        status.expires_at_ms, 0,
        "a disabled schedule carries no deadline"
    );
    assert_eq!(status.mode, AwakeMode::ActiveOnly);
    assert!(!fixture.state().stored.lock().unwrap().enabled);
}
