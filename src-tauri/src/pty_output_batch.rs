//! Coalesces a PTY's reads into fewer, larger IPC messages.
//!
//! The reader loop reads in 4 KiB slices, and every slice used to become its own `Channel` message.
//! An AI agent CLI repainting its prompt box, or any command producing sustained output, therefore
//! generated thousands of messages per second — and each one costs the renderer an IPC dispatch, a
//! UTF-8 decode, a highlighter pass and an xterm `write()`. That volume, not the byte count, is what
//! made the app lag and eventually stop responding under heavy output.
//!
//! Batching happens here rather than in the reader loop because a size-only batch would stall an
//! interactive prompt (a keystroke echo is a handful of bytes, and it must not wait for 64 KiB that
//! may never come). A deadline needs something to wait on, so the reader hands chunks to a batcher
//! thread over a channel and that thread owns the timer.
//!
//! **Ordering is absolute.** Bytes reach the sink in read order, and `finish()` blocks until every
//! pending byte has been pushed — the exit path relies on that to keep a script's last line ahead of
//! the `Closed` status.

use crate::session_output::{push_output, Output};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[cfg(test)]
#[path = "pty_output_batch_tests.rs"]
mod tests;

/// How long the first byte of a batch waits for company. Short enough to stay imperceptible on a
/// keystroke echo, long enough to collapse a repaint burst into one message.
const FLUSH_INTERVAL: Duration = Duration::from_millis(8);

/// Flush early once a batch reaches this size, so a fast producer does not build an arbitrarily large
/// message just because it never went quiet.
const FLUSH_BYTES: usize = 64 * 1024;

/// Chunks in flight before the reader blocks. Backpressure is deliberate: a renderer that cannot keep
/// up should slow the shell down — which is how a real terminal behaves — rather than let this queue
/// grow without bound.
const QUEUE_DEPTH: usize = 256;

pub struct OutputBatcher {
    /// `None` only after `finish` has taken it, which is what signals the thread to drain and stop.
    tx: Option<SyncSender<Vec<u8>>>,
    handle: Option<JoinHandle<()>>,
}

impl OutputBatcher {
    pub fn spawn(output: Arc<Mutex<Output>>) -> Self {
        let (tx, rx) = sync_channel::<Vec<u8>>(QUEUE_DEPTH);
        let handle = thread::spawn(move || run(rx, output));
        Self {
            tx: Some(tx),
            handle: Some(handle),
        }
    }

    /// Hand `bytes` over for delivery. Blocks while the queue is full (see `QUEUE_DEPTH`).
    ///
    /// A send error means the batcher thread is gone, which can only happen after `finish`; the bytes
    /// are dropped rather than panicking a reader thread that is already shutting down.
    pub fn push(&self, bytes: &[u8]) {
        if let Some(tx) = &self.tx {
            let _ = tx.send(bytes.to_vec());
        }
    }

    /// Flush everything pending and stop. Blocks until the last byte has reached the sink.
    pub fn finish(mut self) {
        drop(self.tx.take()); // closing the channel is the stop signal
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for OutputBatcher {
    /// Backstop for a panicking reader: without it, a dropped batcher would leave its thread parked
    /// on `recv` forever holding the session's output alive.
    fn drop(&mut self) {
        drop(self.tx.take());
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn run(rx: Receiver<Vec<u8>>, output: Arc<Mutex<Output>>) {
    let mut batch: Vec<u8> = Vec::with_capacity(FLUSH_BYTES);
    while let Ok(first) = rx.recv() {
        // Block indefinitely for the first chunk: an idle session must not wake up 125 times a second
        // to flush nothing.
        batch.clear();
        batch.extend_from_slice(&first);
        let deadline = Instant::now() + FLUSH_INTERVAL;

        // Accumulate whatever else arrives before the deadline, unless the batch gets big first.
        let mut closed = false;
        while batch.len() < FLUSH_BYTES {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                break;
            };
            match rx.recv_timeout(remaining) {
                Ok(more) => batch.extend_from_slice(&more),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => {
                    closed = true;
                    break;
                }
            }
        }

        push_output(&output, &batch);
        if closed {
            break;
        }
    }
}
