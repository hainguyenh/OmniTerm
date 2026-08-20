use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use app_core::proc_activity::ProcTable;
use sysinfo::System;

use crate::manager::SessionManager;
use crate::output::Output;

const TICK: Duration = Duration::from_millis(500);
const IDLE_CONFIRM_TICKS: u8 = 2;
const COMMAND_GRACE_TICKS: u8 = 4;

#[derive(Debug, Clone, Copy)]
struct ActivitySample {
    descendant_count: usize,
    is_agent: bool,
    recent_output: bool,
    recent_input: bool,
}

struct ActivityState {
    reported: Option<bool>,
    idle_streak: u8,
    command_grace: u8,
    agent_baseline_descendants: Option<usize>,
}

impl ActivityState {
    fn new(launched_with_command: bool) -> Self {
        Self {
            reported: Some(launched_with_command),
            idle_streak: 0,
            command_grace: if launched_with_command {
                COMMAND_GRACE_TICKS
            } else {
                0
            },
            agent_baseline_descendants: None,
        }
    }

    fn observe(&mut self, sample: ActivitySample) -> Option<bool> {
        if sample.is_agent && sample.recent_input {
            self.command_grace = 0;
            self.idle_streak = IDLE_CONFIRM_TICKS;
            if self.reported == Some(false) {
                return None;
            }
            self.reported = Some(false);
            return Some(false);
        }
        if self.command_grace > 0 {
            self.command_grace -= 1;
        }
        let observed_busy = if sample.is_agent {
            let baseline = self
                .agent_baseline_descendants
                .get_or_insert(sample.descendant_count);
            if sample.descendant_count < *baseline {
                *baseline = sample.descendant_count;
            }
            sample.recent_output || sample.descendant_count > *baseline
        } else {
            self.agent_baseline_descendants = None;
            sample.descendant_count > 0
        };
        let busy = observed_busy || self.command_grace > 0;
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
            self.reported.unwrap_or(false)
        };
        if self.reported == Some(next) {
            return None;
        }
        self.reported = Some(next);
        Some(next)
    }
}

struct ActivityTarget {
    id: String,
    pid: Option<u32>,
    launched_with_command: bool,
    output: Arc<Mutex<Output>>,
}

// `spawn` drives the daemon-side activity loop: a 500ms ticker that polls
// every live session's process tree via `sysinfo`, watches for shell exits,
// and reports busy/idle transitions back to the manager. The whole task runs
// for the lifetime of the daemon, so unit tests cannot drive it without a real
// PTY keeping descendants for wall-clock durations. The closure handed to
// `tokio::spawn` compiles to a separate generated async fn, which is why the
// `coverage(off)` marker has to live on `run_activity_loop` (the named body)
// rather than on `spawn` itself. CI also exercises this through
// `tests/activity_integration` on Linux.
#[cfg_attr(coverage, coverage(off))]
pub(crate) fn spawn(manager: SessionManager) -> tokio::task::JoinHandle<()> {
    tokio::spawn(run_activity_loop(manager))
}

#[cfg_attr(coverage, coverage(off))]
async fn run_activity_loop(manager: SessionManager) {
    let mut system = Some(System::new());
    let mut states: HashMap<String, ActivityState> = HashMap::new();
    let mut ticker = tokio::time::interval(TICK);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticker.tick().await;
        if manager.sessions.is_empty() {
            states.clear();
            continue;
        }
        let targets: Vec<ActivityTarget> = manager
            .sessions
            .iter()
            .map(|entry| ActivityTarget {
                id: entry.key().clone(),
                pid: entry.pid,
                launched_with_command: entry.launched_with_command,
                output: Arc::clone(&entry.output),
            })
            .collect();
        states.retain(|id, _| targets.iter().any(|target| &target.id == id));
        let owned = system.take().unwrap_or_default();
        let snapshot = tokio::task::spawn_blocking(move || {
            let mut owned = owned;
            let table = ProcTable::snapshot(&mut owned);
            (table, owned)
        })
        .await;
        let Ok((table, owned)) = snapshot else {
            system = Some(System::new());
            continue;
        };
        system = Some(owned);
        for target in targets {
            let state = states
                .entry(target.id.clone())
                .or_insert_with(|| ActivityState::new(target.launched_with_command));
            let agent = target
                .output
                .lock()
                .map(|output| output.agent_activity())
                .unwrap_or_default();
            let descendant_count = target.pid.map_or(0, |root| {
                if agent.is_agent {
                    table.descendants(root).len()
                } else if table.has_descendant(root) {
                    1
                } else {
                    0
                }
            });
            let sample = ActivitySample {
                descendant_count,
                is_agent: agent.is_agent,
                recent_output: agent.recent_output,
                recent_input: agent.recent_input,
            };
            if let Some(next) = state.observe(sample) {
                manager.update_activity(&target.id, next);
            }
        }
    }
}

#[cfg(test)]
#[path = "activity_tests.rs"]
mod tests;
