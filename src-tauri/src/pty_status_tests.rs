use super::*;
use session_protocol::AttachSnapshot;
use tauri::ipc::InvokeResponseBody;

fn discarding_channel() -> Channel<SessionStatus> {
    Channel::new(|_body: InvokeResponseBody| Ok(()))
}

#[test]
fn daemon_statuses_map_to_renderer_statuses() {
    assert_eq!(
        to_tauri_status(DaemonStatus::Ready {
            label: "bash".to_string(),
        }),
        SessionStatus::Ready {
            label: "bash".to_string(),
            replay: None,
        }
    );
    assert_eq!(
        to_tauri_status(DaemonStatus::Error {
            message: "lost".to_string(),
        }),
        SessionStatus::Error {
            message: "lost".to_string(),
        }
    );
    assert_eq!(
        to_tauri_status(DaemonStatus::Closed { code: 7 }),
        SessionStatus::Closed { code: 7 }
    );
    assert_eq!(
        to_tauri_status(DaemonStatus::Activity { busy: true }),
        SessionStatus::Activity { busy: true }
    );
}

#[test]
fn initial_status_handles_ready_error_closed_and_unknown_snapshots() {
    let channel = discarding_channel();
    send_initial_status(
        &channel,
        &AttachSnapshot {
            status: "ready".to_string(),
            label: None,
            error: None,
            busy: true,
            generation: 4,
            replay_available: Some(true),
            replay_bytes: None,
        },
        12,
    );
    send_initial_status(
        &channel,
        &AttachSnapshot {
            status: "error".to_string(),
            label: None,
            error: None,
            busy: false,
            generation: 0,
            replay_available: None,
            replay_bytes: None,
        },
        0,
    );
    send_initial_status(
        &channel,
        &AttachSnapshot {
            status: "closed".to_string(),
            label: Some("ignored".to_string()),
            error: Some("ignored".to_string()),
            busy: false,
            generation: 0,
            replay_available: None,
            replay_bytes: None,
        },
        0,
    );
    send_initial_status(
        &channel,
        &AttachSnapshot {
            status: "unknown".to_string(),
            label: None,
            error: None,
            busy: false,
            generation: 0,
            replay_available: None,
            replay_bytes: None,
        },
        0,
    );
}
