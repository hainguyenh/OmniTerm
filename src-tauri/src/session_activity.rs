//! The busy/idle ticker: one task that tells every pane whether its shell is running something.
//!
//! One global ticker, not one task per session. The whole cost of this feature is enumerating the
//! process table, so it is taken **once per tick and shared by every pane** — per-session tasks would
//! mean N enumerations per tick and N shutdown paths to wire into both teardown routes. A session that
//! leaves `PtyManager.sessions` (user typed `exit`, or `kill_session` ran) is simply not iterated on
//! the next tick, so there is nothing to unregister.

use crate::proc_activity::ProcTable;
use crate::pty::{PtyManager, SessionStatus};
use crate::session_output::Output;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use sysinfo::System;
use tauri::{AppHandle, Manager, Runtime};

#[cfg(test)]
#[path = "session_activity_tests.rs"]
mod tests;

/// Poll cadence: fast enough that a returning prompt feels immediate, slow enough that a full process
/// enumeration stays a rounding error on one core.
const TICK: Duration = Duration::from_millis(500);
/// Consecutive idle observations before idle is reported. Busy reports on the first observation; idle
/// waits, so a shell between two stages of a pipeline does not flicker to "idle" and back.
const IDLE_CONFIRM_TICKS: u8 = 2;
/// How long a command-launched pane is held busy before the probe alone decides. Covers the gap
/// between spawning the shell and the shell actually forking the command (profile loading), and the
/// batch case where the work happens inside cmd.exe with no child to find.
const COMMAND_GRACE_TICKS: u8 = 4;

/// Per-session debounce state. Owned by the poller task alone, so it needs no lock and no place in
/// `PtyManager`.
#[derive(Debug)]
pub struct ActivityState {
    /// What the renderer has been told, or `None` if nothing yet.
    reported: Option<bool>,
    idle_streak: u8,
    command_grace: u8,
}

impl ActivityState {
    pub fn new(launched_with_command: bool) -> Self {
        Self {
            // start_local_session already sent this as the baseline, so the first tick must not
            // repeat it.
            reported: Some(launched_with_command),
            idle_streak: 0,
            command_grace: if launched_with_command {
                COMMAND_GRACE_TICKS
            } else {
                0
            },
        }
    }

    /// Feed one observation. Returns `Some(busy)` only when the reported state changed — the
    /// redundancy filter that lets the renderer treat this as a plain flag.
    pub fn observe(&mut self, has_descendant: bool) -> Option<bool> {
        // The grace expires on its own and never re-arms: after it, the probe is the only authority.
        if self.command_grace > 0 {
            self.command_grace -= 1;
        }
        let busy = has_descendant || self.command_grace > 0;
        if busy {
            self.idle_streak = 0;
        } else {
            self.idle_streak = self.idle_streak.saturating_add(1);
        }
        let next = if busy {
            true
        } else if self.idle_streak >= IDLE_CONFIRM_TICKS {
            false
        } else {
            // Still confirming — hold whatever the renderer already believes.
            self.reported.unwrap_or(false)
        };
        if self.reported == Some(next) {
            return None;
        }
        self.reported = Some(next);
        Some(next)
    }
}

/// One session as the poller sees it, copied out of the DashMap so no shard guard is held across a
/// process snapshot or an IPC send.
pub struct Target {
    pub id: String,
    pub pid: Option<u32>,
    pub launched_with_command: bool,
}

/// The whole tick except the snapshot and the sends: which sessions changed state, in order. Also
/// prunes `states` of sessions that have gone, so a long, session-heavy run cannot grow the map.
pub fn resolve_tick(
    table: &ProcTable,
    states: &mut HashMap<String, ActivityState>,
    targets: &[Target],
) -> Vec<(String, bool)> {
    states.retain(|id, _| targets.iter().any(|t| &t.id == id));
    let mut changed = Vec::new();
    for target in targets {
        let state = states
            .entry(target.id.clone())
            .or_insert_with(|| ActivityState::new(target.launched_with_command));
        // A session whose pid was never reported can never be observed busy, but it still runs
        // through `observe` so its baseline settles to idle like everyone else's.
        let busy = target.pid.is_some_and(|pid| table.has_descendant(pid));
        if let Some(next) = state.observe(busy) {
            changed.push((target.id.clone(), next));
        }
    }
    changed
}

fn listening_target(
    id: String,
    pid: Option<u32>,
    launched_with_command: bool,
    output: &Arc<Mutex<Output>>,
) -> Option<(Target, Arc<Mutex<Output>>)> {
    let listening = output
        .lock()
        .map(|out| out.has_status_sink())
        .unwrap_or(false);
    listening.then(|| {
        (
            Target {
                id,
                pid,
                launched_with_command,
            },
            Arc::clone(output),
        )
    })
}

fn deliver_changes(
    outputs: &HashMap<String, Arc<Mutex<Output>>>,
    changes: &[(String, bool)],
) {
    for (id, busy) in changes {
        if let Some(output) = outputs.get(id) {
            crate::session_output::send_status(output, SessionStatus::Activity { busy: *busy });
        }
    }
}

/// Start the single activity poller. Called once from `run()`'s setup.
pub fn spawn_poller<R: Runtime>(app: AppHandle<R>) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        // Handed to a blocking thread and back on every tick (see below), so it lives in an Option.
        let mut sys = Some(System::new());
        let mut states: HashMap<String, ActivityState> = HashMap::new();
        let mut ticker = tokio::time::interval(TICK);
        // Delay, not Burst: on laptop resume the default would fire every missed tick back to back,
        // i.e. a storm of full process enumerations.
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            // Gone once the app is shutting down; there is nothing left to poll.
            let Some(manager) = app.try_state::<PtyManager>() else {
                return;
            };
            if manager.sessions.is_empty() {
                states.clear();
                continue;
            }
            let mut outputs: HashMap<String, Arc<Mutex<Output>>> = HashMap::new();
            let mut targets = Vec::new();
            for entry in manager.sessions.iter() {
                // A detached pane has no status sink until its new window attaches. Polling it would
                // fail every send and, worse, discard the debounce state below on every tick — so it
                // sits out until someone is listening again.
                if let Some((target, output)) = listening_target(
                    entry.key().clone(),
                    entry.pid,
                    entry.launched_with_command,
                    &entry.output,
                ) {
                    outputs.insert(target.id.clone(), output);
                    targets.push(target);
                }
            }
            if targets.is_empty() {
                states.clear();
                continue;
            }
            // Every shard guard is released by here, so a concurrent disconnect never waits on us.
            //
            // The snapshot is a blocking whole-machine enumeration, so it goes to a blocking thread
            // rather than running inline in this async task: on a busy box (Docker Desktop, WSL, a
            // few hundred processes) it is long enough that holding an async worker for it every
            // TICK adds latency to the IPC commands sharing that runtime — including the keystrokes
            // of `send_session_input`.
            let owned = sys.take().unwrap_or_default();
            let table = match tokio::task::spawn_blocking(move || {
                let mut owned = owned;
                let table = ProcTable::snapshot(&mut owned);
                (table, owned)
            })
            .await
            {
                Ok((table, owned)) => {
                    sys = Some(owned);
                    table
                }
                // The snapshot thread died (runtime shutting down, or a panic inside sysinfo). Skip
                // this tick; the next one allocates a fresh `System`.
                Err(e) => {
                    log::warn!("[activity] process snapshot failed: {e}");
                    continue;
                }
            };
            let changes = resolve_tick(&table, &mut states, &targets);
            // `send_status` records `busy` on the session even when the sink is gone, so a window
            // attaching later still learns whether the shell is working.
            deliver_changes(&outputs, &changes);
        }
    })
}
