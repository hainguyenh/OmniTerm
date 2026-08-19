use std::collections::VecDeque;
use std::io::Read;
use std::sync::{Arc, Mutex};

use session_protocol::{AttachSnapshot, DaemonStatus, ServerMessage, SessionLifecycle};
use tokio::sync::broadcast;

use crate::agent_activity::{AgentActivitySample, AgentActivityTracker};

const BUFFER_CAP: usize = 256 * 1024;
const LINE_SCAN_LIMIT: usize = 8 * 1024;
const STREAM_CAP: usize = 1024;

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
