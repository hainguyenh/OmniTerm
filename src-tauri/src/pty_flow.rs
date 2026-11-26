//! Flow control for session output on its way to the renderer.
//!
//! A Tauri `Channel::send` never waits for the webview: every payload is parked in an unbounded
//! queue until the page fetches it. `spawn_stream` used to read the daemon as fast as the socket
//! allowed, so a chatty agent in a busy or throttled window grew the app's memory without limit, and
//! the daemon's own bounded broadcast never saw the slow reader behind it.
//!
//! Each stream now counts the bytes it sent that the renderer has not yet written to xterm. Past
//! `HIGH_WATER` it stops reading the daemon until the renderer acknowledges enough to fall to
//! `LOW_WATER`; while it waits, the daemon's bounded buffer and its "fell behind" path take over.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::Notify;

#[cfg(test)]
#[path = "pty_flow_tests.rs"]
mod tests;

/// Unacknowledged output past which a stream stops reading the daemon.
pub(crate) const HIGH_WATER: usize = 8 * 1024 * 1024;
/// Reading resumes once the renderer has caught up to this much.
pub(crate) const LOW_WATER: usize = HIGH_WATER / 2;

#[derive(Default)]
pub(crate) struct OutputCredit {
    unacked: AtomicUsize,
    closed: AtomicBool,
    drained: Notify,
}

impl OutputCredit {
    pub(crate) fn sent(&self, bytes: usize) {
        self.unacked.fetch_add(bytes, Ordering::AcqRel);
    }

    /// The renderer wrote `bytes` to its terminal. Saturates: a renderer that acknowledges output of
    /// an older stream under the same id must not wrap the count.
    pub(crate) fn ack(&self, bytes: usize) {
        let mut current = self.unacked.load(Ordering::Acquire);
        let remaining = loop {
            let next = current.saturating_sub(bytes);
            match self.unacked.compare_exchange_weak(
                current,
                next,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => break next,
                Err(actual) => current = actual,
            }
        };
        if remaining <= LOW_WATER {
            self.drained.notify_waiters();
        }
    }

    pub(crate) fn unacked(&self) -> usize {
        self.unacked.load(Ordering::Acquire)
    }

    /// Another stream took over the id, or the session went away: a waiting stream gives up.
    pub(crate) fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.drained.notify_waiters();
    }

    fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
    }

    /// Waits while the renderer is too far behind. False once the credit is closed.
    pub(crate) async fn room(&self) -> bool {
        if self.unacked() < HIGH_WATER {
            return !self.is_closed();
        }
        loop {
            // Registered before the checks, so an ack landing between them still wakes this wait.
            let notified = self.drained.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.is_closed() {
                return false;
            }
            if self.unacked() <= LOW_WATER {
                return true;
            }
            notified.await;
        }
    }
}

/// The live credit of each session id. One stream per id is current: opening a new one (a reconnect,
/// a pane re-attaching in another window) closes the credit of the stream it replaces.
#[derive(Default)]
pub(crate) struct OutputFlows {
    credits: DashMap<String, Arc<OutputCredit>>,
}

impl OutputFlows {
    pub(crate) fn open(&self, id: &str) -> Arc<OutputCredit> {
        let credit = Arc::new(OutputCredit::default());
        if let Some(previous) = self.credits.insert(id.to_string(), Arc::clone(&credit)) {
            previous.close();
        }
        credit
    }

    pub(crate) fn ack(&self, id: &str, bytes: usize) {
        if let Some(credit) = self.credits.get(id) {
            credit.ack(bytes);
        }
    }

    /// A stream ended: forget its credit unless a newer stream already replaced it.
    pub(crate) fn release(&self, id: &str, credit: &Arc<OutputCredit>) {
        self.credits
            .remove_if(id, |_, current| Arc::ptr_eq(current, credit));
    }

    pub(crate) fn close(&self, id: &str) {
        if let Some((_, credit)) = self.credits.remove(id) {
            credit.close();
        }
    }
}
