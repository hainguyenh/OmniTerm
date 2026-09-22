use app_protocol::session_status::{ReplayMetadata, SessionStatus};
use session_protocol::DaemonStatus;
use tauri::ipc::Channel;

pub(crate) fn to_tauri_status(status: DaemonStatus) -> SessionStatus {
    match status {
        DaemonStatus::Ready { label } => SessionStatus::Ready {
            label,
            replay: None,
        },
        DaemonStatus::Error { message } => SessionStatus::Error { message },
        DaemonStatus::Closed { code } => SessionStatus::Closed { code },
        DaemonStatus::Activity { busy } => SessionStatus::Activity { busy },
    }
}

pub(crate) fn send_initial_status(
    on_status: &Channel<SessionStatus>,
    snapshot: &session_protocol::AttachSnapshot,
    replay_bytes: usize,
) {
    match snapshot.status.as_str() {
        "ready" => {
            let _ = on_status.send(SessionStatus::Ready {
                label: snapshot
                    .label
                    .clone()
                    .unwrap_or_else(|| "Terminal".to_string()),
                replay: Some(ReplayMetadata {
                    available: snapshot.replay_available,
                    bytes: replay_bytes,
                    generation: snapshot.generation,
                }),
            });
            let _ = on_status.send(SessionStatus::Activity {
                busy: snapshot.busy,
            });
        }
        "error" => {
            let _ = on_status.send(SessionStatus::Error {
                message: snapshot
                    .error
                    .clone()
                    .unwrap_or_else(|| "Terminal session failed".to_string()),
            });
        }
        "closed" => {
            let _ = on_status.send(SessionStatus::Closed { code: 0 });
        }
        _ => {}
    }
}
