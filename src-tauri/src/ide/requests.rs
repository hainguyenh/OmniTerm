//! Cancellable requests: the webview allocates ids and `cancel_request` cancels them.
//!
//! A cancel can arrive before the command that owns the id has begun (the UI shows a task with a
//! Cancel button and then awaits other work first). Such a cancel is remembered for a while, so the
//! request starts out cancelled instead of running to the end.

use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use ide_core::{CancellationToken, RequestId};
use tauri::State;

/// How long a cancel for a request that has not begun is remembered.
const EARLY_CANCEL_TTL: Duration = Duration::from_secs(120);
/// At most this many are remembered; ids of finished requests end up here too.
const EARLY_CANCEL_MAX: usize = 1024;

#[derive(Default)]
struct Inner {
    running: HashMap<RequestId, CancellationToken>,
    /// Cancelled before they began, oldest first.
    early: VecDeque<(RequestId, Instant)>,
}

impl Inner {
    fn prune(&mut self, now: Instant) {
        while self
            .early
            .front()
            .is_some_and(|(_, at)| now.duration_since(*at) > EARLY_CANCEL_TTL)
            || self.early.len() > EARLY_CANCEL_MAX
        {
            self.early.pop_front();
        }
    }
}

#[derive(Default)]
pub struct Requests {
    inner: Mutex<Inner>,
}

impl Requests {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        // The state holds plain collections that stay valid even if a holder panicked.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn begin(&self, id: RequestId) -> CancellationToken {
        let token = CancellationToken::new();
        let mut inner = self.lock();
        inner.prune(Instant::now());
        if let Some(index) = inner.early.iter().position(|(early, _)| *early == id) {
            inner.early.remove(index);
            token.cancel();
            return token;
        }
        if let Some(old) = inner.running.insert(id, token.clone()) {
            old.cancel();
        }
        token
    }

    pub fn end(&self, id: RequestId) {
        self.lock().running.remove(&id);
    }

    pub fn cancel(&self, id: RequestId) {
        let mut inner = self.lock();
        match inner.running.remove(&id) {
            Some(token) => token.cancel(),
            None => {
                let now = Instant::now();
                inner.early.push_back((id, now));
                inner.prune(now);
            }
        }
    }
}

#[tauri::command]
pub fn cancel_request(requests: State<'_, Requests>, id: RequestId) {
    requests.cancel(id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_reaches_a_running_request() {
        let requests = Requests::default();
        let token = requests.begin(RequestId(1));
        assert!(!token.is_cancelled());
        requests.cancel(RequestId(1));
        assert!(token.is_cancelled());
    }

    #[test]
    fn a_cancel_before_begin_cancels_the_request_when_it_begins() {
        let requests = Requests::default();
        requests.cancel(RequestId(7));
        assert!(requests.begin(RequestId(7)).is_cancelled());
        assert!(!requests.begin(RequestId(7)).is_cancelled(), "only once");
        assert!(!requests.begin(RequestId(8)).is_cancelled());
    }

    #[test]
    fn early_cancels_are_bounded() {
        let requests = Requests::default();
        let total = u32::try_from(EARLY_CANCEL_MAX).expect("small constant") + 10;
        for id in 0..total {
            requests.cancel(RequestId(id));
        }
        assert_eq!(requests.lock().early.len(), EARLY_CANCEL_MAX);
        assert!(
            !requests.begin(RequestId(0)).is_cancelled(),
            "oldest dropped"
        );
        assert!(requests.begin(RequestId(total - 1)).is_cancelled());
    }

    #[test]
    fn a_finished_request_is_not_cancelled_again() {
        let requests = Requests::default();
        let token = requests.begin(RequestId(3));
        requests.end(RequestId(3));
        requests.cancel(RequestId(3));
        assert!(!token.is_cancelled());
    }
}
