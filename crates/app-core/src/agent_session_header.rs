//! The head of an agent transcript: where the conversation ran and how it started.
//!
//! Only the first lines are read (bounded by [`HEAD_BYTES`] and [`HEAD_LINES`]); a transcript is
//! never loaded whole here. Malformed lines are skipped: an unreadable head just leaves the
//! working directory and title empty.

use serde_json::Value;
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

use crate::agent_session_index::SessionAgent;

const HEAD_BYTES: u64 = 256 * 1024;
const HEAD_LINES: usize = 60;
const TITLE_CHARS: usize = 120;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SessionHeader {
    pub cwd: Option<String>,
    pub title: Option<String>,
    /// Codex's session id (from `session_meta`); Claude's is the file name.
    pub session_id: Option<String>,
}

/// Strict `8-4-4-4-12` hex UUID: the only session ids whose companion files are ever removed.
pub fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => *b == b'-',
            _ => b.is_ascii_hexdigit(),
        })
}

/// One line of text, whitespace collapsed, cut to [`TITLE_CHARS`] characters.
fn shorten(text: &str) -> Option<String> {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.is_empty() {
        return None;
    }
    let mut short: String = flat.chars().take(TITLE_CHARS).collect();
    if flat.chars().count() > TITLE_CHARS {
        short.push('…');
    }
    Some(short)
}

/// The text of a message `content`: a string, or the first text part of a part list.
fn content_text(content: &Value) -> Option<&str> {
    match content {
        Value::String(text) => Some(text),
        Value::Array(parts) => parts.iter().find_map(|part| {
            let kind = part.get("type").and_then(Value::as_str);
            if matches!(kind, Some("text" | "input_text")) {
                part.get("text").and_then(Value::as_str)
            } else {
                None
            }
        }),
        _ => None,
    }
}

/// A prompt the user typed, as opposed to the context and command wrappers agents inject as user
/// turns (`<environment_context>`, `<command-name>`, `Caveat: ...`).
fn typed_prompt(text: &str) -> Option<String> {
    let trimmed = text.trim_start();
    if trimmed.starts_with('<') || trimmed.starts_with("Caveat:") {
        return None;
    }
    shorten(trimmed)
}

fn claude_line(value: &Value, header: &mut SessionHeader) {
    if header.cwd.is_none() {
        header.cwd = value.get("cwd").and_then(Value::as_str).map(str::to_string);
    }
    let is_user = value.get("type").and_then(Value::as_str) == Some("user");
    let is_meta = value.get("isMeta").and_then(Value::as_bool) == Some(true);
    let is_sidechain = value.get("isSidechain").and_then(Value::as_bool) == Some(true);
    if header.title.is_none() && is_user && !is_meta && !is_sidechain {
        header.title = value
            .pointer("/message/content")
            .and_then(content_text)
            .and_then(typed_prompt);
    }
}

fn codex_line(value: &Value, header: &mut SessionHeader) {
    // Current rollouts wrap records in `{type, payload}`; the first versions wrote them bare.
    let record = value.get("payload").unwrap_or(value);
    // Only the session meta record carries a UUID `id`; message ids look different.
    if header.session_id.is_none() {
        header.session_id = record
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| is_uuid(id))
            .map(str::to_string);
    }
    if header.cwd.is_none() {
        header.cwd = record
            .get("cwd")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    let is_user_message = record.get("type").and_then(Value::as_str) == Some("message")
        && record.get("role").and_then(Value::as_str) == Some("user");
    if header.title.is_none() && is_user_message {
        header.title = record
            .get("content")
            .and_then(content_text)
            .and_then(typed_prompt);
    }
}

fn parse_lines(reader: impl BufRead, agent: SessionAgent) -> SessionHeader {
    let mut header = SessionHeader::default();
    for line in reader.lines().take(HEAD_LINES) {
        let Ok(line) = line else { break };
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match agent {
            SessionAgent::Claude => claude_line(&value, &mut header),
            SessionAgent::Codex => codex_line(&value, &mut header),
        }
        if header.cwd.is_some()
            && header.title.is_some()
            && (agent == SessionAgent::Claude || header.session_id.is_some())
        {
            break;
        }
    }
    header
}

/// Reads the head of `path`; an unreadable file gives an empty header.
pub fn read_header(path: &Path, agent: SessionAgent) -> SessionHeader {
    match File::open(path) {
        Ok(file) => parse_lines(BufReader::new(file.take(HEAD_BYTES)), agent),
        Err(_) => SessionHeader::default(),
    }
}

#[cfg(test)]
pub(crate) fn parse_text(text: &str, agent: SessionAgent) -> SessionHeader {
    parse_lines(text.as_bytes(), agent)
}

#[cfg(test)]
#[path = "agent_session_header_tests.rs"]
mod tests;
