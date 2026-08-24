//! Shell exit bookkeeping: mark the session closed, tear down its Windows job
//! tree, and persist the terminal lifecycle once — without letting a late
//! watcher overwrite a newer generation's manifest.

use std::sync::Arc;

use session_protocol::{DaemonStatus, SessionLifecycle};

use crate::manager::{Session, SessionManager};

pub(crate) fn spawn(
    manager: SessionManager,
    id: String,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    session: Arc<Session>,
) {
    tokio::spawn(async move {
        let code = tokio::task::spawn_blocking(move || {
            child.wait().map(|status| status.exit_code()).unwrap_or(0)
        })
        .await
        .unwrap_or(0);
        #[cfg(windows)]
        if let Some(job) = &session.job {
            job.terminate(code);
        }
        if let Ok(mut lifecycle) = session.lifecycle.lock() {
            *lifecycle = SessionLifecycle::Closed;
        }
        if let Ok(mut output) = session.output.lock() {
            output.status(DaemonStatus::Closed { code });
        }
        // Do not let an explicit disconnect's late exit watcher recreate/overwrite its manifest.
        let still_current = manager
            .sessions
            .get(&id)
            .is_some_and(|current| Arc::ptr_eq(current.value(), &session));
        if still_current {
            manager.persist(&id, &session);
        }
    });
}
