use session_protocol::{PersistencePolicy, SessionLifecycle, SessionSummary};

use crate::manager::Session;

pub(crate) fn session_summary(id: &str, session: &Session) -> SessionSummary {
    let policy = session
        .policy
        .lock()
        .map(|value| *value)
        .unwrap_or(PersistencePolicy::KeepRunning);
    let lifecycle = session
        .lifecycle
        .lock()
        .map(|value| *value)
        .unwrap_or(SessionLifecycle::Error);
    let busy = session.output.lock().map(|value| value.busy()).unwrap_or(false);
    SessionSummary {
        id: id.to_string(),
        generation: session.generation,
        policy,
        lifecycle,
        pid: session.pid,
        label: session.launch.label.clone(),
        busy,
        launched_with_command: session.launched_with_command,
        ssh: session.ssh,
    }
}
