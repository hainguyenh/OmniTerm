use std::collections::HashMap;
use std::time::Duration;

use app_core::proc_activity::ProcTable;
use sysinfo::System;

use crate::manager::SessionManager;

const TICK: Duration = Duration::from_millis(500);
const IDLE_CONFIRM_TICKS: u8 = 2;
const COMMAND_GRACE_TICKS: u8 = 4;

struct ActivityState {
    reported: Option<bool>,
    idle_streak: u8,
    command_grace: u8,
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
        }
    }

    fn observe(&mut self, has_descendant: bool) -> Option<bool> {
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
            self.reported.unwrap_or(false)
        };
        if self.reported == Some(next) {
            return None;
        }
        self.reported = Some(next);
        Some(next)
    }
}

pub(crate) fn spawn(manager: SessionManager) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
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
            let targets: Vec<_> = manager
                .sessions
                .iter()
                .map(|entry| {
                    (
                        entry.key().clone(),
                        entry.pid,
                        entry.launched_with_command,
                    )
                })
                .collect();
            states.retain(|id, _| targets.iter().any(|target| &target.0 == id));
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
            for (id, pid, launched) in targets {
                let state = states
                    .entry(id.clone())
                    .or_insert_with(|| ActivityState::new(launched));
                let busy = pid.is_some_and(|root| table.has_descendant(root));
                if let Some(next) = state.observe(busy) {
                    manager.update_activity(&id, next);
                }
            }
        }
    })
}
