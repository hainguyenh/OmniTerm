//! FreezeWhileClosed lifecycle: suspend trees when the last GUI client leaves,
//! resume them before any attach or mutation touches the session again, and
//! reap verified frozen orphans after a daemon crash (Unix; Windows job objects
//! already kill suspended trees when the daemon dies).

use std::sync::atomic::Ordering;
use std::sync::Arc;

use session_protocol::{PersistencePolicy, SessionLifecycle};

use crate::manager::{Session, SessionManager};

pub(crate) fn on_client_disconnected(manager: &SessionManager, client_id: &str) {
    // Existing behavior first: CloseWithApp sessions die with their owner.
    for (id, session) in owned_sessions(manager, client_id) {
        if policy_of(&session) == Some(PersistencePolicy::CloseWithApp) {
            let _ = manager.disconnect(&id);
        }
    }
    // New behavior: FreezeWhileClosed sessions pause until a client returns.
    for (id, session) in owned_sessions(manager, client_id) {
        if policy_of(&session) == Some(PersistencePolicy::FreezeWhileClosed) {
            freeze(manager, &id, &session);
        }
    }
}

fn owned_sessions(manager: &SessionManager, client_id: &str) -> Vec<(String, Arc<Session>)> {
    manager
        .sessions
        .iter()
        .filter(|entry| {
            entry
                .owner_client
                .lock()
                .map(|owner| owner.as_str() == client_id)
                .unwrap_or(false)
        })
        .map(|entry| (entry.key().clone(), Arc::clone(entry.value())))
        .collect()
}

fn policy_of(session: &Session) -> Option<PersistencePolicy> {
    session.policy.lock().ok().map(|policy| *policy)
}

pub(crate) fn freeze(manager: &SessionManager, id: &str, session: &Session) {
    // Never signal a dead lifecycle: once the shell exited, the recorded pid
    // may already belong to a different process.
    let live = session
        .lifecycle
        .lock()
        .map(|lifecycle| *lifecycle == SessionLifecycle::Live)
        .unwrap_or(false);
    if !live {
        return;
    }
    let Some(pid) = session.pid else {
        return;
    };
    // Swap guards double-freeze (two GUI windows closing concurrently).
    if !session.frozen.swap(true, Ordering::AcqRel) {
        return;
    }
    if let Err(error) = crate::suspend::suspend_tree(pid) {
        log::debug!("[sessiond] could not freeze {id}: {error}");
        session.frozen.store(false, Ordering::Release);
        return;
    }
    if let Ok(mut slot) = session.frozen_pid.lock() {
        *slot = session.pid;
    }
    if let Ok(mut slot) = session.start_time.lock() {
        *slot = crate::suspend::process_start_time(pid);
    }
    manager.persist(id, session);
}

pub(crate) fn ensure_resumed(manager: &SessionManager, id: &str, session: &Session) {
    if !session.frozen.swap(false, Ordering::AcqRel) {
        return;
    }
    // If the shell died while frozen (for example killed externally), there is
    // nothing to resume — and the recorded pid may belong to another process by
    // now. Clear the bookkeeping without signalling.
    let live = session
        .lifecycle
        .lock()
        .map(|lifecycle| *lifecycle == SessionLifecycle::Live)
        .unwrap_or(false);
    let mut persist_now = false;
    if !live {
        if let Ok(mut slot) = session.start_time.lock() {
            *slot = None;
        }
        if let Ok(mut slot) = session.frozen_pid.lock() {
            *slot = None;
        }
        persist_now = true;
    } else {
        match session.pid.map(crate::suspend::resume_tree) {
            Some(Ok(())) | None => {
                if let Ok(mut slot) = session.start_time.lock() {
                    *slot = None;
                }
                if let Ok(mut slot) = session.frozen_pid.lock() {
                    *slot = None;
                }
                // Persist immediately: a quiet resumed shell may never trigger
                // another manifest write, and a stale on-disk `frozen: true`
                // would make the next boot sweep kill this healthy shell.
                persist_now = true;
            }
            Some(Err(error)) => {
                log::debug!("[sessiond] could not resume session: {error}");
                session.frozen.store(true, Ordering::Release);
            }
        }
    }
    if persist_now {
        manager.persist(id, session);
    }
}

/// After a daemon crash a Unix frozen tree would stay SIGSTOPped forever,
/// holding memory while reparented to init. Windows needs nothing here: its
/// per-session kill-on-close job already terminated the tree when the daemon
/// died. Kill an orphan only when both pid and start time match the manifest,
/// so a recycled pid is never signalled.
#[cfg(unix)]
pub(crate) fn kill_frozen_orphans_sweep(
    interrupted: &dashmap::DashMap<String, crate::manifest::SessionManifest>,
) {
    for record in interrupted.iter() {
        let (Some(pid), Some(start_time)) = (record.pid, record.start_time) else {
            continue;
        };
        if !record.frozen {
            continue;
        }
        if crate::suspend::process_start_time(pid) == Some(start_time) {
            // SAFETY: signal delivery; identity was double-checked via start time.
            unsafe {
                libc::kill(pid as libc::pid_t, libc::SIGKILL);
            }
            log::debug!("[sessiond] reaped frozen orphan pid {pid}");
        }
    }
}

#[cfg(not(unix))]
pub(crate) fn kill_frozen_orphans_sweep(
    _interrupted: &dashmap::DashMap<String, crate::manifest::SessionManifest>,
) {
}

#[cfg(test)]
#[cfg(unix)]
#[path = "freeze_tests.rs"]
mod tests;
