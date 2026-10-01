//! Plain-text export of one Claude Code conversation, for the pane footer's "Save output".
//!
//! The terminal buffer cannot hold a whole agent conversation: xterm keeps a bounded scrollback
//! and Claude Code clears and redraws it, so saving the buffer kept only the tail. Claude's own
//! session file (`<profile>/projects/<encoded cwd>/<session id>.jsonl`) has every turn. This module
//! finds that file and renders it as readable text. It runs only when the user explicitly saves,
//! and the text goes only to the file they pick.
//!
//! Rendering is deliberately lossy: prompts and replies are kept verbatim, tool calls and their
//! results become one-line markers, and thinking, sidechains (sub-agents), meta entries and
//! bookkeeping records are left out. Malformed lines are skipped, never fatal.

use serde_json::Value;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[cfg(test)]
#[path = "claude_transcript_tests.rs"]
mod tests;

/// Larger than any real session file; reading past this would stall the save dialog.
pub const MAX_TRANSCRIPT_BYTES: u64 = 256 * 1024 * 1024;
/// How much of a tool's input or result a marker line keeps.
const MARKER_CHARS: usize = 200;

/// `<profile_dir>/projects/<any project>/<session_id>.jsonl`, one directory level deep. The caller
/// validates `session_id` as a bare UUID first; symlinked files are ignored.
pub fn find_transcript(profile_dir: &Path, session_id: &str) -> Option<PathBuf> {
    let file_name = format!("{session_id}.jsonl");
    fs::read_dir(profile_dir.join("projects"))
        .ok()?
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path().join(&file_name))
        .find(|path| fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_file()))
}

/// Read and render the session file; errors when it is missing, oversized or unreadable.
pub fn export_transcript(profile_dir: &Path, session_id: &str) -> io::Result<String> {
    let path = find_transcript(profile_dir, session_id)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "session file not found"))?;
    if fs::metadata(&path)?.len() > MAX_TRANSCRIPT_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "session file is too large to export",
        ));
    }
    let bytes = fs::read(&path)?;
    Ok(render_transcript(
        &String::from_utf8_lossy(&bytes),
        session_id,
    ))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Speaker {
    User,
    Claude,
}

impl Speaker {
    fn label(self) -> &'static str {
        match self {
            Speaker::User => "User",
            Speaker::Claude => "Claude",
        }
    }
}

struct Writer {
    out: String,
    speaker: Option<Speaker>,
}

impl Writer {
    /// Starts a new heading only when the speaker changes: Claude writes one line per content
    /// block, so a single reply spans many records.
    fn push(&mut self, speaker: Speaker, timestamp: Option<&str>, text: &str) {
        if self.speaker != Some(speaker) {
            self.out.push_str("## ");
            self.out.push_str(speaker.label());
            if let Some(at) = timestamp.map(format_timestamp).filter(|at| !at.is_empty()) {
                self.out.push_str(" — ");
                self.out.push_str(&at);
            }
            self.out.push_str("\n\n");
            self.speaker = Some(speaker);
        }
        self.out.push_str(text.trim_end());
        self.out.push_str("\n\n");
    }
}

/// Render JSONL session records as a conversation. Returns just the title when nothing renders.
pub fn render_transcript(jsonl: &str, session_id: &str) -> String {
    let mut writer = Writer {
        out: format!("# Claude Code conversation {session_id}\n\n"),
        speaker: None,
    };
    for record in jsonl
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
    {
        render_record(&mut writer, &record);
    }
    let trimmed = writer.out.trim_end().len();
    writer.out.truncate(trimmed);
    writer.out.push('\n');
    writer.out
}

fn render_record(writer: &mut Writer, record: &Value) {
    let flag = |name: &str| record.get(name).and_then(Value::as_bool).unwrap_or(false);
    if flag("isSidechain") || flag("isMeta") {
        return;
    }
    let timestamp = record.get("timestamp").and_then(Value::as_str);
    let content = record.pointer("/message/content");
    match record.get("type").and_then(Value::as_str) {
        Some("user") if flag("isCompactSummary") => {
            writer.push(Speaker::User, timestamp, "[Conversation compacted]");
        }
        Some("user") => match content {
            Some(Value::String(text)) => {
                if let Some(text) = user_text(text) {
                    writer.push(Speaker::User, timestamp, &text);
                }
            }
            Some(Value::Array(blocks)) => {
                for block in blocks {
                    render_user_block(writer, timestamp, block);
                }
            }
            _ => {}
        },
        Some("assistant") => {
            for block in content.and_then(Value::as_array).into_iter().flatten() {
                render_assistant_block(writer, timestamp, block);
            }
        }
        _ => {}
    }
}

fn render_user_block(writer: &mut Writer, timestamp: Option<&str>, block: &Value) {
    match block.get("type").and_then(Value::as_str) {
        Some("text") => {
            if let Some(text) = block
                .get("text")
                .and_then(Value::as_str)
                .and_then(user_text)
            {
                writer.push(Speaker::User, timestamp, &text);
            }
        }
        // A tool result belongs to Claude's turn: it answers the call Claude just made.
        Some("tool_result") => {
            let failed = block.get("is_error").and_then(Value::as_bool) == Some(true);
            let body = block.get("content").map(result_text).unwrap_or_default();
            let tag = if failed { "tool error" } else { "tool result" };
            writer.push(Speaker::Claude, timestamp, &marker(tag, &body));
        }
        _ => {}
    }
}

fn render_assistant_block(writer: &mut Writer, timestamp: Option<&str>, block: &Value) {
    match block.get("type").and_then(Value::as_str) {
        Some("text") => {
            let text = block.get("text").and_then(Value::as_str).unwrap_or("");
            if !text.trim().is_empty() {
                writer.push(Speaker::Claude, timestamp, text);
            }
        }
        Some("tool_use") => {
            let name = block.get("name").and_then(Value::as_str).unwrap_or("tool");
            let input = block
                .get("input")
                .map(tool_input_summary)
                .unwrap_or_default();
            writer.push(
                Speaker::Claude,
                timestamp,
                &marker(&format!("tool: {name}"), &input),
            );
        }
        _ => {}
    }
}

/// A typed prompt, or a slash command reduced to its name; harness-injected noise is dropped.
fn user_text(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("<local-command-")
        || trimmed.starts_with("<system-reminder>")
    {
        return None;
    }
    if let Some(name) = between(trimmed, "<command-name>", "</command-name>") {
        let args = between(trimmed, "<command-args>", "</command-args>").unwrap_or("");
        return Some(format!("{name} {args}").trim_end().to_string());
    }
    if trimmed.starts_with("<command-message>") {
        return None;
    }
    Some(trimmed.to_string())
}

fn between<'a>(text: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = text.find(open)? + open.len();
    let end = text[start..].find(close)? + start;
    Some(text[start..end].trim())
}

/// The field that says what a call did (`command`, `file_path`, …), else the compact JSON input.
fn tool_input_summary(input: &Value) -> String {
    [
        "description",
        "command",
        "file_path",
        "path",
        "pattern",
        "url",
        "query",
        "prompt",
    ]
    .iter()
    .find_map(|key| input.get(*key).and_then(Value::as_str))
    .map(str::to_string)
    .unwrap_or_else(|| input.to_string())
}

fn result_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// `[tag] first line…`, capped at [`MARKER_CHARS`] characters.
fn marker(tag: &str, body: &str) -> String {
    let first = body
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();
    let mut short: String = first.chars().take(MARKER_CHARS).collect();
    if short.len() < first.len() || body.trim().lines().nth(1).is_some() {
        short.push('…');
    }
    if short.is_empty() {
        format!("[{tag}]")
    } else {
        format!("[{tag}] {short}")
    }
}

/// `2026-09-30T08:15:02.123Z` → `2026-09-30 08:15:02 UTC`; anything unexpected is kept as is.
fn format_timestamp(raw: &str) -> String {
    let Some((date, time)) = raw.split_once('T') else {
        return raw.to_string();
    };
    let clock = time.split(['.', 'Z', '+']).next().unwrap_or(time);
    let zone = if raw.ends_with('Z') { " UTC" } else { "" };
    format!("{date} {clock}{zone}")
}
