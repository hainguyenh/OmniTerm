//! The Always Awake rules, with no runtime attached: which schedules keep the machine awake, when a
//! schedule has expired, and which terminal sessions count as working.

use super::*;
use crate::proc_activity::ProcTable;

fn stored(enabled: bool, mode: AwakeMode, expires_at_ms: i64) -> StoredState {
    StoredState {
        enabled,
        mode,
        expires_at_ms,
    }
}

fn target(ssh: bool, launched_with_command: bool, pid: Option<u32>) -> AwakeTarget {
    AwakeTarget {
        ssh,
        launched_with_command,
        pid,
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

// ── the schedule rule ──────────────────────────────────────────────────────────────────────────

#[test]
fn active_only_waits_for_activity() {
    let state = stored(true, AwakeMode::ActiveOnly, 100);
    assert!(!should_keep_awake(&state, 0));
    assert_eq!(should_keep_awake(&state, 1), cfg!(windows));
}

#[test]
fn always_mode_does_not_require_a_session() {
    assert_eq!(should_keep_awake(&stored(true, AwakeMode::Always, 100), 0), cfg!(windows));
}

#[test]
fn a_disabled_schedule_never_keeps_the_machine_awake() {
    assert!(!should_keep_awake(&stored(false, AwakeMode::Always, 100), 5));
    assert!(!should_keep_awake(&stored(false, AwakeMode::ActiveOnly, 100), 5));
}

#[test]
fn expiry_is_inclusive() {
    let state = stored(true, AwakeMode::Always, 100);
    assert!(!is_expired(&state, 99));
    assert!(is_expired(&state, 100));
    assert!(is_expired(&state, 101));
}

#[test]
fn an_open_ended_or_disabled_schedule_never_expires() {
    // expires_at_ms == 0 is the "no deadline" encoding `set_state` writes when disabling.
    assert!(!is_expired(&stored(true, AwakeMode::Always, 0), i64::MAX));
    assert!(!is_expired(&stored(false, AwakeMode::Always, 1), i64::MAX));
}

#[test]
fn mode_wire_names_are_stable() {
    assert_eq!(serde_json::to_string(&AwakeMode::ActiveOnly).unwrap(), "\"activeOnly\"");
    assert_eq!(serde_json::to_string(&AwakeMode::Always).unwrap(), "\"always\"");
    assert_eq!(AwakeMode::default(), AwakeMode::ActiveOnly);
}

#[test]
fn the_stored_default_is_off() {
    let default = StoredState::default();
    assert!(!default.enabled);
    assert_eq!(default.mode, AwakeMode::ActiveOnly);
    assert_eq!(default.expires_at_ms, 0);
}

#[test]
fn now_ms_is_a_positive_wall_clock_reading() {
    // 2020-01-01, comfortably in the past: this only has to prove the clock is not zero or negative.
    assert!(now_ms() > 1_577_836_800_000);
}

// ── the activity rule ──────────────────────────────────────────────────────────────────────────

#[test]
fn a_shell_running_a_child_process_is_active() {
    assert!(session_is_active(&target(false, false, Some(100)), &table()));
}

#[test]
fn a_shell_at_its_prompt_is_not_active() {
    assert!(!session_is_active(&target(false, false, Some(200)), &table()));
}

#[test]
fn a_session_without_a_pid_is_not_active() {
    assert!(!session_is_active(&target(false, false, None), &table()));
}

#[test]
fn ssh_counts_as_active_even_at_a_prompt() {
    // The remote shell's state is not visible in the local process tree, so the transport alone
    // decides. Without this, an idle SSH pane running a long remote job would let the host sleep.
    assert!(session_is_active(&target(true, false, Some(200)), &table()));
    assert!(session_is_active(&target(true, false, None), &table()));
}

#[test]
fn a_command_launched_session_counts_as_active() {
    assert!(session_is_active(&target(false, true, Some(200)), &table()));
}

#[test]
fn active_sessions_are_counted_not_just_detected() {
    let targets = [
        target(false, false, Some(100)), // busy shell
        target(true, false, Some(200)),  // ssh
        target(false, true, None),       // launched with a command
        target(false, false, Some(200)), // idle
        target(false, false, None),      // no pid
    ];
    assert_eq!(active_session_count(&targets, &table()), 3);
    assert_eq!(active_session_count(&[], &table()), 0);
}
