//! Debounce and fan-out rules of the activity poller. Pure: no processes, no channels, no ticker.

use super::*;
use crate::proc_activity::ProcTable;
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody, Response};

fn plain(id: &str, pid: u32) -> Target {
    Target {
        id: id.to_string(),
        pid: Some(pid),
        launched_with_command: false,
    }
}

/// A shell (pid 100) with one child, so `has_descendant(100)` is true.
fn busy_table() -> ProcTable {
    ProcTable::from_rows([(100u32, 1u32, 10u64, "pwsh.exe"), (101, 100, 20, "ping.exe")])
}

fn idle_table() -> ProcTable {
    ProcTable::from_rows([(100u32, 1u32, 10u64, "pwsh.exe")])
}

fn output_with_status_log() -> (Arc<Mutex<Output>>, Arc<Mutex<Vec<SessionStatus>>>) {
    let data = Channel::<Response>::new(|_| Ok(()));
    let log = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&log);
    let status = Channel::<SessionStatus>::new(move |body| {
        if let InvokeResponseBody::Json(text) = body {
            sink.lock().unwrap().push(serde_json::from_str(&text).unwrap());
        }
        Ok(())
    });
    (
        Arc::new(Mutex::new(Output::new(data, status, "shell".into()))),
        log,
    )
}

#[test]
fn a_plain_shells_first_idle_observation_says_nothing_new() {
    // start_local_session already sent `busy: false` as the baseline.
    let mut state = ActivityState::new(false);
    assert_eq!(state.observe(false), None);
}

#[test]
fn the_first_busy_observation_reports_immediately() {
    let mut state = ActivityState::new(false);
    assert_eq!(state.observe(true), Some(true));
}

#[test]
fn a_run_of_busy_observations_reports_once() {
    let mut state = ActivityState::new(false);
    assert_eq!(state.observe(true), Some(true));
    for _ in 0..10 {
        assert_eq!(state.observe(true), None);
    }
}

#[test]
fn idle_is_reported_only_after_it_is_confirmed() {
    let mut state = ActivityState::new(false);
    state.observe(true);
    assert_eq!(state.observe(false), None, "first idle tick only starts the streak");
    assert_eq!(state.observe(false), Some(false));
    assert_eq!(state.observe(false), None, "and then stays quiet");
}

/// The concrete case: a shell between two stages of a pipeline has no child for one tick. That must
/// not flicker the tab to idle and straight back.
#[test]
fn a_one_tick_gap_between_child_processes_is_suppressed() {
    let mut state = ActivityState::new(false);
    assert_eq!(state.observe(true), Some(true));
    assert_eq!(state.observe(false), None);
    assert_eq!(state.observe(true), None, "still busy as far as the renderer knows");
}

#[test]
fn a_command_launched_session_reads_busy_until_the_grace_expires() {
    let mut state = ActivityState::new(true);
    // Baseline was already `busy: true`, so nothing is re-sent while the grace holds.
    for _ in 0..COMMAND_GRACE_TICKS {
        assert_eq!(state.observe(false), None);
    }
    // Grace over, and the idle streak has long since passed IDLE_CONFIRM_TICKS.
    assert_eq!(state.observe(false), Some(false));
}

#[test]
fn the_command_grace_does_not_re_arm_after_a_later_busy_period() {
    let mut state = ActivityState::new(true);
    for _ in 0..COMMAND_GRACE_TICKS {
        state.observe(false);
    }
    assert_eq!(state.observe(false), Some(false));
    assert_eq!(state.observe(true), Some(true), "a real child is still detected");
    // Idle now takes effect on the normal confirm delay, not another full grace.
    assert_eq!(state.observe(false), None);
    assert_eq!(state.observe(false), Some(false));
}

#[test]
fn resolve_tick_reports_each_session_independently() {
    let table = ProcTable::from_rows([
        (100u32, 1u32, 10u64, "pwsh.exe"),
        (101, 100, 20, "ping.exe"),
        (200, 1, 10, "cmd.exe"),
    ]);
    let targets = vec![plain("busy-pane", 100), plain("idle-pane", 200)];
    let mut states = HashMap::new();
    assert_eq!(
        resolve_tick(&table, &mut states, &targets),
        vec![("busy-pane".to_string(), true)],
    );
}

#[test]
fn a_session_without_a_pid_never_reports_busy() {
    let targets = vec![Target {
        id: "no-pid".to_string(),
        pid: None,
        launched_with_command: false,
    }];
    let mut states = HashMap::new();
    for _ in 0..5 {
        assert!(resolve_tick(&busy_table(), &mut states, &targets).is_empty());
    }
}

#[test]
fn state_for_a_closed_session_is_pruned() {
    let mut states = HashMap::new();
    let targets = vec![plain("pane-1", 100)];
    resolve_tick(&busy_table(), &mut states, &targets);
    assert_eq!(states.len(), 1);

    resolve_tick(&idle_table(), &mut states, &[]);
    assert!(states.is_empty(), "the pane is gone, so is its debounce state");
}

/// A pane that closes and re-opens under the same id starts from a clean baseline rather than
/// inheriting the old shell's streak.
#[test]
fn a_reopened_session_starts_fresh() {
    let mut states = HashMap::new();
    let targets = vec![plain("pane-1", 100)];
    assert_eq!(resolve_tick(&busy_table(), &mut states, &targets).len(), 1);
    resolve_tick(&idle_table(), &mut states, &[]);
    // Same id again: busy must be announced anew, because the renderer's tab was reset too.
    assert_eq!(
        resolve_tick(&busy_table(), &mut states, &targets),
        vec![("pane-1".to_string(), true)],
    );
}

#[test]
fn target_collection_requires_a_live_status_sink_and_handles_poisoning() {
    let (output, _) = output_with_status_log();
    let (target, cloned) = listening_target("pane".into(), Some(42), true, &output).unwrap();
    assert_eq!(target.id, "pane");
    assert_eq!(target.pid, Some(42));
    assert!(target.launched_with_command);
    assert!(Arc::ptr_eq(&output, &cloned));

    output.lock().unwrap().detach();
    assert!(listening_target("pane".into(), None, false, &output).is_none());

    let (poisoned, _) = output_with_status_log();
    let poisoned_clone = Arc::clone(&poisoned);
    let _ = std::panic::catch_unwind(move || {
        let _guard = poisoned_clone.lock().unwrap();
        panic!("poison output lock");
    });
    assert!(listening_target("pane".into(), None, false, &poisoned).is_none());
}

#[test]
fn change_delivery_updates_known_outputs_and_ignores_closed_sessions() {
    let (output, log) = output_with_status_log();
    let outputs = HashMap::from([("known".to_string(), output)]);
    deliver_changes(
        &outputs,
        &[("missing".to_string(), true), ("known".to_string(), true)],
    );
    assert_eq!(
        *log.lock().unwrap(),
        vec![SessionStatus::Activity { busy: true }]
    );
}


#[test]
fn poller_exits_cleanly_when_no_pty_manager_is_registered() {
    let app = crate::test_support::mock_app();
    let task = spawn_poller(app.handle().clone());
    tauri::async_runtime::block_on(task)
        .expect("poller task should stop without managed PTY state");
}
