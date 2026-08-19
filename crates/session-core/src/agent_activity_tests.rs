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
    assert!(!sample.recent_output, "local-input echo must not animate the activity effect");
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
