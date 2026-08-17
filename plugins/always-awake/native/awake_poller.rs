//! The Always Awake poller thread: when it starts, how it stops, and who owns the sleep request.

use super::*;

/// Start the poller the first time the frontend asks for Always Awake, and never again.
///
/// `run()` used to spawn this from `setup`, which made the feature a built-in: the loop ran on every
/// launch whether or not the Always Awake plugin was installed. The frontend only calls `get_state`
/// once the plugin has answered `alwaysAwake.info`, so gating the spawn here means a build without
/// the plugin never polls, never reads the power configuration and never asserts anything.
pub(super) fn ensure_poller<R: Runtime>(app: &AppHandle<R>, state: &AlwaysAwakeState) {
    if state.poller_started.swap(true, Ordering::AcqRel) {
        return;
    }
    let _poller = spawn_poller(app.clone());
}

/// Drop the sleep request, if one is held.
///
/// Must run on the thread that took the request out — see `spawn_poller`.
pub(super) fn release_assertion(state: &AlwaysAwakeState) {
    if !state.native_asserted.swap(false, Ordering::AcqRel) {
        return;
    }
    if let Err(error) = native::apply_assertion(false) {
        set_error(state, Some(error));
    }
}

/// Wait out one tick, in slices, so a shutdown request is noticed in tens of milliseconds rather
/// than up to a whole tick later — quitting should not leave the machine held awake while the poller
/// finishes a nap. Returns false when the poller should stop.
fn sleep_until_tick(state: &AlwaysAwakeState) -> bool {
    const SLICE: Duration = Duration::from_millis(50);
    let mut remaining = TICK;
    while !remaining.is_zero() {
        if state.shutting_down.load(Ordering::Acquire) {
            return false;
        }
        let nap = remaining.min(SLICE);
        std::thread::sleep(nap);
        remaining -= nap;
    }
    !state.shutting_down.load(Ordering::Acquire)
}

/// Run the Always Awake loop on one dedicated OS thread, for the life of the app.
///
/// The thread is the whole point, and it is not an optimisation. `SetThreadExecutionState` records
/// the sleep request against **the calling thread**, and a request is only dropped by calling it
/// again on that same thread. This loop used to be a `tauri::async_runtime::spawn` task on Tauri's
/// multi-threaded tokio runtime, where every `tick().await` is a point at which the task can resume
/// on a different worker. So the request was taken out on whichever worker happened to run the tick
/// that switched Always Awake on, and "off" later called `SetThreadExecutionState(ES_CONTINUOUS)` on
/// some *other* worker — which succeeds, clears nothing, and reports success. The panel went to OFF
/// and the machine carried on refusing to sleep, with no way back short of ending the process.
///
/// Owning the state on a thread of our own makes assert and release provably the same thread, and
/// lets the release happen before that thread goes away.
pub fn spawn_poller<R: Runtime>(app: AppHandle<R>) -> std::thread::JoinHandle<()> {
    std::thread::Builder::new()
        .name("always-awake".to_string())
        .spawn(move || {
            let Some(state) = app.try_state::<AlwaysAwakeState>() else {
                return;
            };
            let _ = load_state(&app, &state);
            let mut system = System::new();
            loop {
                // Both exits hand the request back first: this is the only thread that can, and once
                // it returns nothing else could have.
                if !sleep_until_tick(&state) {
                    release_assertion(&state);
                    return;
                }
                let Some(manager) = app.try_state::<crate::pty::PtyManager>() else {
                    release_assertion(&state);
                    return;
                };
                // A blocking process enumeration, which is another reason this does not belong on an
                // async worker — sessiond offloads its own process snapshot for the same reason.
                let table = if manager.sessions.is_empty() {
                    crate::proc_activity::ProcTable::default()
                } else {
                    crate::proc_activity::ProcTable::snapshot(&mut system)
                };
                reconcile(&app, &state, &table);
            }
        })
        .expect("spawn the Always Awake poller thread")
}

#[cfg(test)]
#[path = "always_awake_poller_tests.rs"]
mod tests;
