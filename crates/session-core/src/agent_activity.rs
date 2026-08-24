use std::time::{Duration, Instant};

pub(crate) const INPUT_ECHO_QUIET: Duration = Duration::from_millis(500);
pub(crate) const OUTPUT_BUSY_TAIL: Duration = Duration::from_millis(1_500);
const OSC_BUFFER_LIMIT: usize = 4 * 1024;
const OSC_PREFIX_LEN: usize = 4;

const AGENT_ALIASES: &[&str] = &[
    "antigravity-cli",
    "antigravity cli",
    "google antigravity",
    "antigravity",
    "claude code",
    "claude-code",
    "codex cli",
    "codex-cli",
    "cursor agent",
    "copilot cli",
    "continue dev",
    "gemini cli",
    "open-code",
    "open code",
    "opencode",
    "swe-agent",
    "sweagent",
    "claude",
    "codex",
    "aider",
    "cursor",
    "copilot",
    "continue",
    "cline",
    "goose",
    "devin",
    "gemini",
    "agy",
];

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct AgentActivitySample {
    pub(crate) is_agent: bool,
    pub(crate) recent_output: bool,
    pub(crate) recent_input: bool,
}

#[derive(Debug, Default)]
pub(crate) struct AgentActivityTracker {
    osc_buffer: Vec<u8>,
    is_agent: bool,
    last_input: Option<Instant>,
    last_autonomous_output: Option<Instant>,
}

impl AgentActivityTracker {
    pub(crate) fn note_input(&mut self) {
        self.note_input_at(Instant::now());
    }

    pub(crate) fn observe_output(&mut self, bytes: &[u8]) {
        self.observe_output_at(bytes, Instant::now());
    }

    pub(crate) fn sample(&self) -> AgentActivitySample {
        self.sample_at(Instant::now())
    }

    pub(crate) fn note_input_at(&mut self, now: Instant) {
        self.last_input = Some(now);
        self.last_autonomous_output = None;
    }

    pub(crate) fn observe_output_at(&mut self, bytes: &[u8], now: Instant) {
        self.observe_titles(bytes);
        if !self.is_agent {
            return;
        }
        let echo_quiet = self
            .last_input
            .is_some_and(|input| now.saturating_duration_since(input) < INPUT_ECHO_QUIET);
        if !echo_quiet && !bytes.is_empty() {
            self.last_autonomous_output = Some(now);
        }
    }

    pub(crate) fn sample_at(&self, now: Instant) -> AgentActivitySample {
        let recent_input = self.is_agent
            && self
                .last_input
                .is_some_and(|input| now.saturating_duration_since(input) < INPUT_ECHO_QUIET);
        let recent_output = self.is_agent
            && self
                .last_autonomous_output
                .is_some_and(|output| now.saturating_duration_since(output) <= OUTPUT_BUSY_TAIL);
        AgentActivitySample {
            is_agent: self.is_agent,
            recent_output,
            recent_input,
        }
    }

    fn observe_titles(&mut self, bytes: &[u8]) {
        self.osc_buffer.extend_from_slice(bytes);
        loop {
            let Some(start) = find_osc_title_start(&self.osc_buffer) else {
                keep_partial_osc_prefix(&mut self.osc_buffer);
                return;
            };
            if start > 0 {
                self.osc_buffer.drain(..start);
            }
            let title_start = OSC_PREFIX_LEN;
            let Some((title_end, terminator_len)) =
                find_osc_terminator(&self.osc_buffer[title_start..])
            else {
                if self.osc_buffer.len() > OSC_BUFFER_LIMIT {
                    self.osc_buffer
                        .drain(..self.osc_buffer.len() - OSC_BUFFER_LIMIT);
                }
                return;
            };
            let title_end = title_start + title_end;
            let title = String::from_utf8_lossy(&self.osc_buffer[title_start..title_end]);
            self.is_agent = title_is_agent(&title);
            self.osc_buffer.drain(..title_end + terminator_len);
        }
    }
}

fn find_osc_title_start(bytes: &[u8]) -> Option<usize> {
    bytes.windows(OSC_PREFIX_LEN).position(|window| {
        window[0] == 0x1b
            && window[1] == b']'
            && matches!(window[2], b'0' | b'2')
            && window[3] == b';'
    })
}

fn find_osc_terminator(bytes: &[u8]) -> Option<(usize, usize)> {
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == 0x07 {
            return Some((index, 1));
        }
        if bytes[index] == 0x1b && bytes.get(index + 1) == Some(&b'\\') {
            return Some((index, 2));
        }
        index += 1;
    }
    None
}

fn keep_partial_osc_prefix(bytes: &mut Vec<u8>) {
    let keep = bytes.len().min(OSC_PREFIX_LEN - 1);
    if bytes.len() > keep {
        bytes.drain(..bytes.len() - keep);
    }
}

fn is_boundary(byte: Option<u8>) -> bool {
    byte.map_or(true, |value| !value.is_ascii_alphanumeric())
}

pub(crate) fn title_is_agent(title: &str) -> bool {
    let lower = title.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    AGENT_ALIASES.iter().any(|&alias| {
        let alias_bytes = alias.as_bytes();
        lower.match_indices(alias).any(|(index, _)| {
            is_boundary(
                index
                    .checked_sub(1)
                    .and_then(|before| bytes.get(before).copied()),
            ) && is_boundary(bytes.get(index + alias_bytes.len()).copied())
        })
    })
}

#[cfg(test)]
#[path = "agent_activity_tests.rs"]
mod tests;
