use std::collections::VecDeque;
use std::io::Read;
use std::sync::{Arc, Mutex};

use session_protocol::{AttachSnapshot, DaemonStatus, ServerMessage, SessionLifecycle};
use tokio::sync::broadcast;

use crate::agent_activity::{AgentActivitySample, AgentActivityTracker};

const BUFFER_CAP: usize = 256 * 1024;
const LINE_SCAN_LIMIT: usize = 8 * 1024;
const STREAM_CAP: usize = 1024;

// Compile-time check that `trim`'s scan window stays inside the buffer. `trim`
// peeks up to LINE_SCAN_LIMIT bytes into the tail starting at `len - BUFFER_CAP`,
// which is exactly BUFFER_CAP bytes long, so requiring BUFFER_CAP to be greater
// than LINE_SCAN_LIMIT guarantees the iterator's `take(LINE_SCAN_LIMIT)` window
// never runs past the buffer regardless of buffer length. The `.min` clamp in
// `trim` keeps `drain` safe even if a future edit breaks this, but this
// assertion fails the build before that can happen.
const _: () = assert!(BUFFER_CAP > LINE_SCAN_LIMIT);

#[derive(Debug, Clone)]
enum Lifecycle {
    Ready { label: String },
    Error { message: String },
    Closed,
}

pub(crate) struct Output {
    buffer: VecDeque<u8>,
    lifecycle: Lifecycle,
    busy: bool,
    stream: broadcast::Sender<ServerMessage>,
    agent_activity: AgentActivityTracker,
}

impl Output {
    pub(crate) fn new(label: String, busy: bool) -> Self {
        let (stream, _) = broadcast::channel(STREAM_CAP);
        Self {
            buffer: VecDeque::new(),
            lifecycle: Lifecycle::Ready { label },
            busy,
            stream,
            agent_activity: AgentActivityTracker::default(),
        }
    }

    pub(crate) fn seed(&mut self, bytes: &[u8]) {
        self.buffer.extend(bytes);
        self.trim();
    }

    pub(crate) fn replay(&self) -> Vec<u8> {
        self.buffer.iter().copied().collect()
    }

    pub(crate) fn push(&mut self, bytes: &[u8]) {
        self.agent_activity.observe_output(bytes);
        self.buffer.extend(bytes);
        self.trim();
        let _ = self.stream.send(ServerMessage::Data {
            data: bytes.to_vec(),
        });
    }

    fn trim(&mut self) {
        if self.buffer.len() <= BUFFER_CAP {
            return;
        }
        // `BUFFER_CAP > LINE_SCAN_LIMIT` holds (enforced at compile time at the
        // top of this file), so the scan window of `LINE_SCAN_LIMIT` bytes past
        // `len - BUFFER_CAP` can never reach past the buffer. The `.min` clamp
        // keeps `drain` safe even if a future edit breaks that invariant.
        let start = self.buffer.len() - BUFFER_CAP;
        let drop_extra = self
            .buffer
            .iter()
            .skip(start)
            .take(LINE_SCAN_LIMIT)
            .position(|&b| b == b'\n')
            .map(|idx| idx + 1)
            .unwrap_or(LINE_SCAN_LIMIT);
        let drop_to = (start + drop_extra).min(self.buffer.len());
        self.buffer.drain(..drop_to);
    }

    pub(crate) fn status(&mut self, status: DaemonStatus) {
        match &status {
            DaemonStatus::Ready { label } => {
                self.lifecycle = Lifecycle::Ready {
                    label: label.clone(),
                };
            }
            DaemonStatus::Error { message } => {
                self.lifecycle = Lifecycle::Error {
                    message: message.clone(),
                };
            }
            DaemonStatus::Closed { .. } => self.lifecycle = Lifecycle::Closed,
            DaemonStatus::Activity { busy } => self.busy = *busy,
        }
        let _ = self.stream.send(ServerMessage::Status { status });
    }

    pub(crate) fn attach(
        &mut self,
        generation: u64,
    ) -> (AttachSnapshot, Vec<u8>, broadcast::Receiver<ServerMessage>) {
        let receiver = self.stream.subscribe();
        let replay = self.buffer.make_contiguous().to_vec();
        (self.snapshot(generation), replay, receiver)
    }

    pub(crate) fn note_input(&mut self) {
        self.agent_activity.note_input();
    }

    pub(crate) fn agent_activity(&self) -> AgentActivitySample {
        self.agent_activity.sample()
    }

    pub(crate) fn busy(&self) -> bool {
        self.busy
    }

    pub(crate) fn snapshot(&self, generation: u64) -> AttachSnapshot {
        let (status, label, error) = match &self.lifecycle {
            Lifecycle::Ready { label } => ("ready", Some(label.clone()), None),
            Lifecycle::Error { message } => ("error", None, Some(message.clone())),
            Lifecycle::Closed => ("closed", None, None),
        };
        AttachSnapshot {
            status: status.to_string(),
            label,
            error,
            busy: self.busy,
            generation,
        }
    }
}

pub(crate) fn spawn_reader(
    mut reader: Box<dyn Read + Send>,
    output: Arc<Mutex<Output>>,
    lifecycle: Arc<Mutex<SessionLifecycle>>,
) {
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(size) => {
                    if let Ok(mut target) = output.lock() {
                        target.push(&buf[..size]);
                    }
                }
                Err(error) => {
                    if let Ok(mut state) = lifecycle.lock() {
                        *state = SessionLifecycle::Error;
                    }
                    if let Ok(mut target) = output.lock() {
                        target.status(DaemonStatus::Error {
                            message: error.to_string(),
                        });
                    }
                    break;
                }
            }
        }
    });
}

#[cfg(test)]
#[path = "output_tests.rs"]
mod tests;
