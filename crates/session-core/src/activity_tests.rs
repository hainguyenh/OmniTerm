use super::*;

fn sample(descendant_count: usize, is_agent: bool, recent_output: bool) -> ActivitySample {
    ActivitySample {
        descendant_count,
        is_agent,
        recent_output,
        recent_input: false,
    }
}

fn typing_sample(descendant_count: usize) -> ActivitySample {
    ActivitySample {
        descendant_count,
        is_agent: true,
        recent_output: false,
        recent_input: true,
    }
}

#[test]
fn ordinary_shell_activity_still_uses_the_process_tree() {
    let mut state = ActivityState::new(false);
    assert_eq!(state.observe(sample(1, false, false)), Some(true));
    assert_eq!(state.observe(sample(0, false, false)), None);
    assert_eq!(state.observe(sample(0, false, false)), Some(false));
}

#[test]
fn recognized_agent_does_not_stay_busy_just_because_its_tui_process_exists() {
    let mut state = ActivityState::new(false);

    assert_eq!(state.observe(sample(1, false, false)), Some(true));
    assert_eq!(state.observe(sample(1, true, false)), None);
    assert_eq!(state.observe(sample(1, true, false)), Some(false));
}

#[test]
fn recognized_agent_uses_recent_autonomous_output_as_work() {
    let mut state = ActivityState::new(false);

    assert_eq!(state.observe(sample(1, true, true)), Some(true));
    assert_eq!(state.observe(sample(1, true, false)), None);
    assert_eq!(state.observe(sample(1, true, false)), Some(false));
}

#[test]
fn recognized_agent_marks_new_descendant_processes_as_work() {
    let mut state = ActivityState::new(false);

    assert_eq!(state.observe(sample(1, true, false)), None);
    assert_eq!(state.observe(sample(1, true, false)), None);
    assert_eq!(state.observe(sample(2, true, false)), Some(true));
    assert_eq!(state.observe(sample(1, true, false)), None);
    assert_eq!(state.observe(sample(1, true, false)), Some(false));
}

#[test]
fn recognized_agent_local_input_forces_idle_immediately() {
    let mut state = ActivityState::new(false);

    assert_eq!(state.observe(sample(1, true, true)), Some(true));
    assert_eq!(state.observe(typing_sample(1)), Some(false));
}

#[test]
fn launch_grace_is_preserved_for_command_started_sessions() {
    let mut state = ActivityState::new(true);
    for _ in 0..COMMAND_GRACE_TICKS - 1 {
        assert_eq!(state.observe(sample(0, true, false)), None);
    }
    assert_eq!(state.observe(sample(0, true, false)), None);
    assert_eq!(state.observe(sample(0, true, false)), Some(false));
}

#[test]
fn repeated_agent_input_after_idle_suppresses_duplicate_idle_reports() {
    let mut state = ActivityState::new(false);

    // Agent autonomous output reports busy, then local input forces idle.
    assert_eq!(state.observe(sample(1, true, true)), Some(true));
    assert_eq!(state.observe(typing_sample(1)), Some(false));
    // A second local input while already reported idle is suppressed so the
    // daemon does not re-emit a redundant idle event.
    assert_eq!(state.observe(typing_sample(1)), None);
}

#[test]
fn agent_descendant_shrink_lowers_the_busy_baseline() {
    let mut state = ActivityState::new(false);

    // First agent sample sets the baseline to 2 descendants.
    let _ = state.observe(sample(2, true, false));
    // Fewer descendants than the stored baseline shrinks it, so we do not
    // keep reporting spurious busy ticks from a long-lived agent's initial
    // process count.
    assert_eq!(state.observe(sample(1, true, false)), None);
    // After the baseline shrinks to 1, a fresh two-descendant process is busy
    // again (2 > 1), confirming the baseline was updated.
    assert_eq!(state.observe(sample(2, true, false)), Some(true));
}
