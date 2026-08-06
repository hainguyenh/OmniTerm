//! Where a live session's output goes, and what it keeps for whoever attaches next.
//!
//! A `tauri::ipc::Channel` belongs to the webview that created it, so a pane popped out into its own
//! window cannot keep using the channels the main window opened — they die with the tab that made
//! them. This module holds the sink behind a swap, plus a replay buffer so a re-attaching window
//! shows the scrollback instead of a blank pane.
//!
//! **The buffer and the sink live under one lock, deliberately.** With separate locks the reader
//! could append a byte after `attach` snapshots the buffer but before the new channel is installed,
//! and that byte would arrive live *ahead* of the replay it belongs after — visible corruption at
//! exactly the moment the user is watching the window appear.

use crate::pty::SessionStatus;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, Response};

#[cfg(test)]
#[path = "session_output_tests.rs"]
mod tests;

/// How much scrollback a re-attaching window gets. Large enough that a build log survives a pop-out,
/// small enough that a hundred idle panes are not holding tens of megabytes.
const BUFFER_CAP: usize = 256 * 1024;

/// How far past the cap `push` will scan for a newline before giving up and cutting mid-line.
/// Bounds the work when a session emits one enormous line with no break in it.
const LINE_SCAN_LIMIT: usize = 8 * 1024;

/// The lifecycle state a re-attaching window needs in order to render the pane correctly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Lifecycle {
    Ready { label: String },
    Error { message: String },
    Closed { code: u32 },
}

/// What `attach_session` hands back to the renderer.
///
/// Output is *not* in here: the replay goes down the freshly installed data channel as binary,
/// rather than being serialized into this result as a JSON number array — 256 KiB of scrollback
/// costs about a megabyte of JSON that way.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachSnapshot {
    /// "ready" | "error" | "closed" — the same vocabulary `SessionStatus` uses.
    pub status: &'static str,
    pub label: Option<String>,
    pub error: Option<String>,
    /// Whether the shell currently has something running under it.
    pub busy: bool,
}

pub struct Output {
    /// `None` while detached, or once the receiving webview has gone away. Output keeps accumulating
    /// in `buffer` either way, which is what makes a pop-out lossless.
    data: Option<Channel<Response>>,
    status: Option<Channel<SessionStatus>>,
    buffer: VecDeque<u8>,
    lifecycle: Lifecycle,
    busy: bool,
}

impl Output {
    pub fn new(data: Channel<Response>, status: Channel<SessionStatus>, label: String) -> Self {
        Self {
            data: Some(data),
            status: Some(status),
            buffer: VecDeque::new(),
            lifecycle: Lifecycle::Ready { label },
            busy: false,
        }
    }

    /// Buffer `bytes` and forward them to the current sink, if there is one.
    ///
    /// A send failure means the receiving webview is gone. That is routine here — it is exactly what
    /// detaching looks like — so the sink is dropped and reading continues into the buffer. The
    /// reader loop must NOT treat it as end-of-session, or popping a pane out would silently kill
    /// its output for good.
    pub fn push(&mut self, bytes: &[u8]) {
        // `extend(bytes)`, not `extend(bytes.iter().copied())`: std specializes the `Extend<&u8>`
        // impl for a slice iterator into a bulk copy, while the `Copied` adapter falls back to a
        // per-byte `push_back`. This runs once per PTY read, so the difference is not academic.
        self.buffer.extend(bytes);
        self.trim();
        if let Some(channel) = &self.data {
            if channel.send(Response::new(bytes.to_vec())).is_err() {
                self.data = None;
            }
        }
    }

    /// Drop the oldest bytes back down to the cap, continuing to just past the next newline.
    ///
    /// Cutting at an arbitrary offset lands inside an escape sequence about as often as not, and
    /// xterm renders the tail of a half-parsed CSI as garbage across the top of the pane. A split
    /// UTF-8 sequence is fine by comparison — the renderer decodes with `{stream: true}`.
    fn trim(&mut self) {
        if self.buffer.len() <= BUFFER_CAP {
            return;
        }
        let mut drop_to = self.buffer.len() - BUFFER_CAP;
        let mut scanned = 0;
        while scanned < LINE_SCAN_LIMIT {
            match self.buffer.get(drop_to) {
                Some(&b'\n') => {
                    drop_to += 1;
                    break;
                }
                Some(_) => {
                    drop_to += 1;
                    scanned += 1;
                }
                None => break,
            }
        }
        self.buffer.drain(..drop_to);
    }

    /// Report a lifecycle change, remembering it so a later attach can restore the pane's state.
    pub fn send_status(&mut self, status: SessionStatus) {
        match &status {
            SessionStatus::Ready { label } => {
                self.lifecycle = Lifecycle::Ready {
                    label: label.clone(),
                }
            }
            SessionStatus::Error { message } => {
                self.lifecycle = Lifecycle::Error {
                    message: message.clone(),
                }
            }
            SessionStatus::Closed { code } => self.lifecycle = Lifecycle::Closed { code: *code },
            // Activity is a flag, not a lifecycle step: it must not overwrite the Closed an
            // attaching window needs to see.
            SessionStatus::Activity { busy } => self.busy = *busy,
        }
        if let Some(channel) = &self.status {
            if channel.send(status).is_err() {
                self.status = None;
            }
        }
    }

    /// Is there a live status sink? The activity poller skips sessions without one rather than
    /// burning a send — and, worse, discarding its debounce state — on every tick while detached.
    pub fn has_status_sink(&self) -> bool {
        self.status.is_some()
    }

    pub fn busy(&self) -> bool {
        self.busy
    }

    /// Stop delivering. Output continues to accumulate for whoever attaches next.
    pub fn detach(&mut self) {
        self.data = None;
        self.status = None;
    }

    /// Point the session at a new window's channels and replay everything buffered so far.
    ///
    /// Replay happens here, inside the caller's lock, so no live byte can slip in front of it.
    pub fn attach(
        &mut self,
        data: Channel<Response>,
        status: Channel<SessionStatus>,
    ) -> AttachSnapshot {
        if !self.buffer.is_empty() {
            // `make_contiguous` + `to_vec` is two memcpys at worst; the `iter().copied().collect()`
            // this replaced walked a quarter of a megabyte one byte at a time, on the click that
            // opens the window.
            let replay: Vec<u8> = self.buffer.make_contiguous().to_vec();
            // A failure here means the new window died between opening the channel and this call.
            // Leave the sink unset and let the buffer stand for the next attempt.
            if data.send(Response::new(replay)).is_err() {
                return self.snapshot();
            }
        }
        self.data = Some(data);
        self.status = Some(status);
        self.snapshot()
    }

    fn snapshot(&self) -> AttachSnapshot {
        let (status, label, error) = match &self.lifecycle {
            Lifecycle::Ready { label } => ("ready", Some(label.clone()), None),
            Lifecycle::Error { message } => ("error", None, Some(message.clone())),
            Lifecycle::Closed { .. } => ("closed", None, None),
        };
        AttachSnapshot {
            status,
            label,
            error,
            busy: self.busy,
        }
    }

    /// Exposed for tests: how many bytes of scrollback are held.
    #[cfg(test)]
    pub fn buffered(&self) -> Vec<u8> {
        self.buffer.iter().copied().collect()
    }
}

// ── Lock helpers ─────────────────────────────────────────────────────────────
//
// A poisoned lock is logged and dropped rather than unwrapped. It would mean a panic while another
// thread held this session's output; taking the whole pane down over it helps nobody, and the shell
// itself is still perfectly alive.

/// Buffer bytes and forward them to a session's current sink.
pub fn push_output(output: &Arc<Mutex<Output>>, bytes: &[u8]) {
    match output.lock() {
        Ok(mut out) => out.push(bytes),
        Err(_) => log::warn!("[pty] dropping output: the session's output lock is poisoned"),
    }
}

/// Report a lifecycle/activity change on a session's current status sink.
pub fn send_status(output: &Arc<Mutex<Output>>, status: SessionStatus) {
    match output.lock() {
        Ok(mut out) => out.send_status(status),
        Err(_) => log::warn!("[pty] dropping status: the session's output lock is poisoned"),
    }
}
