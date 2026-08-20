use std::time::{Duration, Instant};

use super::*;

fn osc_title(title: &str) -> Vec<u8> {
    format!("\x1b]0;{title}\x07").into_bytes()
}

#[test]
fn known_agent_titles_enter_agent_mode_and_shell_titles_leave_it() {
    let now = Instant::now();
    let mut tracker = AgentActivityTracker::default();

    tracker.observe_output_at(&osc_title("Antigravity CLI 1.1.14"), now);
    assert!(tracker.sample_at(now).is_agent);

    tracker.observe_output_at(&osc_title("PowerShell 7"), now + Duration::from_secs(1));
    assert!(!tracker.sample_at(now + Duration::from_secs(1)).is_agent);
}

#[test]
fn split_osc_title_sequences_are_detected_without_marking_typing_as_work() {
    let now = Instant::now();
    let mut tracker = AgentActivityTracker::default();
    tracker.note_input_at(now);

    tracker.observe_output_at(b"\x1b]2;Antigra", now + Duration::from_millis(10));
    tracker.observe_output_at(b"vity CLI\x07typed text", now + Duration::from_millis(20));

    let sample = tracker.sample_at(now + Duration::from_millis(20));
    assert!(sample.is_agent);
    assert!(
        !sample.recent_output,
        "local-input echo must not animate the activity effect"
    );
}

#[test]
fn autonomous_agent_output_becomes_busy_then_expires() {
    let now = Instant::now();
    let mut tracker = AgentActivityTracker::default();
    tracker.observe_output_at(&osc_title("Claude Code - repo"), now);
    let input = now + OUTPUT_BUSY_TAIL + Duration::from_millis(100);
    tracker.note_input_at(input);

    let echo = input + Duration::from_millis(100);
    tracker.observe_output_at(b"user prompt repaint", echo);
    assert!(!tracker.sample_at(echo).recent_output);

    let autonomous = input + INPUT_ECHO_QUIET + Duration::from_millis(150);
    tracker.observe_output_at(b"thinking...", autonomous);
    assert!(tracker.sample_at(autonomous).recent_output);
    assert!(
        tracker
            .sample_at(autonomous + OUTPUT_BUSY_TAIL - Duration::from_millis(1))
            .recent_output
    );
    assert!(
        !tracker
            .sample_at(autonomous + OUTPUT_BUSY_TAIL + Duration::from_millis(1))
            .recent_output
    );
}

#[test]
fn local_input_immediately_clears_previous_autonomous_activity() {
    let now = Instant::now();
    let mut tracker = AgentActivityTracker::default();
    tracker.observe_output_at(&osc_title("Antigravity CLI - repo"), now);
    assert!(tracker.sample_at(now).recent_output);

    let input = now + Duration::from_millis(100);
    tracker.note_input_at(input);
    let sample = tracker.sample_at(input);
    assert!(sample.recent_input);
    assert!(!sample.recent_output);
}

#[test]
fn agent_matching_uses_token_boundaries() {
    assert!(title_is_agent("codex - project"));
    assert!(title_is_agent("Gemini CLI /workspace"));
    assert!(title_is_agent("OpenCode | repo"));
    assert!(!title_is_agent("my-codexical-tool"));
    assert!(!title_is_agent("ordinary powershell"));
}

#[test]
fn st_terminator_ends_osc_title() {
    let now = Instant::now();
    let mut tracker = AgentActivityTracker::default();
    tracker.observe_output_at(b"\x1b]2;Claude Code\x1b\\", now);
    assert!(tracker.sample_at(now).is_agent);
}

#[test]
fn multiple_osc_titles_in_one_chunk_are_all_processed() {
    let now = Instant::now();
    let mut tracker = AgentActivityTracker::default();
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&osc_title("Claude Code - repo"));
    bytes.extend_from_slice(&osc_title("PowerShell 7"));
    tracker.observe_output_at(&bytes, now);
    assert!(
        !tracker.sample_at(now).is_agent,
        "the loop must continue past the first title"
    );
}

#[test]
fn osc_buffer_truncation_drops_excess_data_without_panicking() {
    let mut tracker = AgentActivityTracker::default();
    let mut bytes = b"\x1b]0;".to_vec();
    bytes.extend(std::iter::repeat(b'x').take(5 * 1024));
    tracker.observe_output(&bytes);
}

#[test]
fn now_wrapper_methods_delegate_to_timestamped_variants() {
    let mut tracker = AgentActivityTracker::default();
    tracker.observe_output(&osc_title("Codex CLI - repo"));
    let idle = tracker.sample();
    assert!(idle.is_agent);
    assert!(idle.recent_output);
    assert!(!idle.recent_input);
    tracker.note_input();
    let after = tracker.sample();
    assert!(after.recent_input);
    assert!(!after.recent_output);
}

#[test]
fn partial_osc_prefix_shorter_than_four_bytes_is_kept() {
    let now = Instant::now();
    let mut tracker = AgentActivityTracker::default();
    tracker.observe_output_at(b"\x1b]2", now);
    tracker.observe_output_at(b";Codex CLI\x1b\\", now + Duration::from_millis(1));
    assert!(tracker.sample_at(now + Duration::from_millis(1)).is_agent);
}
