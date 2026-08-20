//! The Always Awake poller: the thread it owns, and handing the sleep request back.
//!
//! Separate from `always_awake_tests.rs` only because the two together exceed the repo's per-file
//! line limit.

use super::*;
use crate::test_support;

#[test]
fn the_poller_exits_cleanly_when_no_always_awake_state_is_registered() {
    let app = test_support::mock_app();
    spawn_poller(app.handle().clone())
        .join()
        .expect("the poller thread should stop without managed state");
}

#[test]
fn the_poller_runs_on_a_thread_of_its_own() {
    // Not cosmetic: `SetThreadExecutionState` binds the sleep request to the calling thread, so the
    // assert and the release have to be the same thread. A tokio task cannot promise that — it can
    // resume on any worker after an await — which is how "off" used to leave the machine awake.
    let app = test_support::mock_app();
    let handle = spawn_poller(app.handle().clone());
    assert_eq!(handle.thread().name(), Some("always-awake"));
    handle.join().expect("the poller thread should stop");
}

#[test]
fn asking_the_poller_to_stop_ends_the_thread_and_releases_the_request() {
    // The reason this is asserted rather than assumed: the poller holds an `AppHandle`, which keeps
    // the app's managed state alive, so "the PtyManager went away" is not a shutdown signal that
    // ever actually arrives. Without an explicit flag the loop runs until the process dies.
    let app = test_support::mock_app();
    assert!(app.manage(AlwaysAwakeState::new()));
    assert!(app.manage(crate::pty::PtyManager::new()));
    let state = app.state::<AlwaysAwakeState>();
    state.native_asserted.store(true, Ordering::Release);

    let poller = spawn_poller(app.handle().clone());
    state.begin_shutdown();

    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while !poller.is_finished() && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(poller.is_finished(), "the poller must stop when the app asks it to");
    poller.join().expect("the poller thread should stop cleanly");
    assert!(
        !state.native_asserted.load(Ordering::Acquire),
        "quitting must hand the sleep request back, not leave the machine awake"
    );
}

#[test]
fn an_empty_session_manager_still_runs_one_poll_tick() {
    let app = test_support::mock_app();
    assert!(app.manage(AlwaysAwakeState::new()));
    assert!(app.manage(crate::pty::PtyManager::new()));
    let state = app.state::<AlwaysAwakeState>();

    let poller = spawn_poller(app.handle().clone());
    std::thread::sleep(Duration::from_millis(600));
    state.begin_shutdown();

    poller
        .join()
        .expect("the empty-manager poller should stop cleanly");
}

#[test]
fn shutting_down_hands_the_sleep_request_back() {
    let state = AlwaysAwakeState::new();
    state.native_asserted.store(true, Ordering::Release);

    release_assertion(&state);

    assert!(
        !state.native_asserted.load(Ordering::Acquire),
        "the request must be marked released even when the platform refuses"
    );
    // Off Windows there is no request to hand back, so the shim's refusal is recorded rather than
    // swallowed; on Windows the release succeeds and leaves no error behind.
    assert_eq!(state.last_error.lock().unwrap().is_none(), cfg!(windows));
}

#[test]
fn releasing_without_a_request_touches_nothing() {
    let state = AlwaysAwakeState::new();
    release_assertion(&state);
    assert!(!state.native_asserted.load(Ordering::Acquire));
    assert!(
        state.last_error.lock().unwrap().is_none(),
        "a no-op release must not invent an error"
    );
}
