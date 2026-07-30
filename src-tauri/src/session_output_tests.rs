//! Behaviour a popped-out pane depends on: nothing is lost while detached, and the replay is
//! renderable rather than a mid-escape-sequence fragment.

use super::*;
use std::sync::{Arc, Mutex};
use tauri::ipc::InvokeResponseBody;

/// A channel paired with the log of everything it received.
type Recorded<T, C> = (Channel<C>, Arc<Mutex<Vec<T>>>);

/// A channel that records what it was sent. `alive: false` makes every send fail, which is what a
/// closed webview looks like from this side.
fn recording_channel(alive: bool) -> Recorded<Vec<u8>, Response> {
    let log: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&log);
    let channel = Channel::new(move |body: InvokeResponseBody| {
        if !alive {
            return Err(tauri::Error::UnknownPath);
        }
        if let InvokeResponseBody::Raw(bytes) = body {
            sink.lock().unwrap().push(bytes);
        }
        Ok(())
    });
    (channel, log)
}

fn status_channel(alive: bool) -> Recorded<SessionStatus, SessionStatus> {
    let log: Arc<Mutex<Vec<SessionStatus>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&log);
    let channel = Channel::new(move |body: InvokeResponseBody| {
        if !alive {
            return Err(tauri::Error::UnknownPath);
        }
        if let InvokeResponseBody::Json(text) = body {
            sink.lock().unwrap().push(serde_json::from_str(&text).unwrap());
        }
        Ok(())
    });
    (channel, log)
}

fn output(alive: bool) -> Output {
    let (data, _) = recording_channel(alive);
    let (status, _) = status_channel(alive);
    Output::new(data, status, "PowerShell".to_string())
}

#[test]
fn forwards_output_and_keeps_a_copy() {
    let (data, sent) = recording_channel(true);
    let (status, _) = status_channel(true);
    let mut out = Output::new(data, status, "cmd".into());

    out.push(b"hello ");
    out.push(b"world");

    assert_eq!(sent.lock().unwrap().concat(), b"hello world");
    assert_eq!(out.buffered(), b"hello world");
}

/// The regression that makes pop-out work at all: a dead sink is routine (the tab unmounted), not
/// end-of-session. If `push` gave up here, a detached pane would never show another byte.
#[test]
fn keeps_buffering_after_the_sink_dies() {
    let mut out = output(false);

    out.push(b"before");
    out.push(b"after");

    assert_eq!(out.buffered(), b"beforeafter");
}

#[test]
fn attach_replays_the_whole_buffer_in_one_go() {
    let mut out = output(false);
    out.push(b"line one\nline two\n");

    let (data, replayed) = recording_channel(true);
    let (status, _) = status_channel(true);
    let snapshot = out.attach(data, status);

    assert_eq!(replayed.lock().unwrap().concat(), b"line one\nline two\n");
    assert_eq!(snapshot.status, "ready");
    assert_eq!(snapshot.label.as_deref(), Some("PowerShell"));
}

#[test]
fn output_after_an_attach_goes_to_the_new_window() {
    let mut out = output(false);
    let (data, received) = recording_channel(true);
    let (status, _) = status_channel(true);
    out.attach(data, status);

    out.push(b"live");
    assert_eq!(received.lock().unwrap().concat(), b"live");
}

/// Cutting the ring at an arbitrary offset lands inside an escape sequence often enough to be
/// visible: xterm paints the tail of a half-parsed CSI as garbage across the top of the pane.
#[test]
fn eviction_leaves_the_buffer_starting_on_a_line_boundary() {
    let mut out = output(true);
    // Each line is 64 bytes, so the cap lands mid-line and the scan has to walk to the next '\n'.
    let line = format!("{}\n", "x".repeat(63));
    for _ in 0..8000 {
        out.push(line.as_bytes());
    }

    let buffered = out.buffered();
    assert!(buffered.len() <= 256 * 1024, "cap not enforced");
    assert_eq!(buffered[0], b'x', "should start at the head of a line");
    assert_eq!(
        buffered.iter().filter(|&&b| b == b'\n').count(),
        buffered.len() / 64,
        "every retained line should be whole"
    );
}

/// A single line longer than the scan limit must not defeat the cap — better a mid-line cut than an
/// unbounded buffer.
#[test]
fn a_line_longer_than_the_scan_limit_still_gets_trimmed() {
    let mut out = output(true);
    out.push(&vec![b'x'; 400 * 1024]);
    assert!(out.buffered().len() <= 256 * 1024);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

#[test]
fn an_attaching_window_learns_the_session_already_closed() {
    let mut out = output(true);
    out.send_status(SessionStatus::Closed { code: 3 });

    let (data, _) = recording_channel(true);
    let (status, _) = status_channel(true);
    assert_eq!(out.attach(data, status).status, "closed");
}

#[test]
fn an_attaching_window_learns_the_session_errored() {
    let mut out = output(true);
    out.send_status(SessionStatus::Error {
        message: "pipe broke".into(),
    });

    let (data, _) = recording_channel(true);
    let (status, _) = status_channel(true);
    let snapshot = out.attach(data, status);
    assert_eq!(snapshot.status, "error");
    assert_eq!(snapshot.error.as_deref(), Some("pipe broke"));
}

/// Activity is a flag, not a lifecycle step. Letting it overwrite the stored state would have a pane
/// that exited come back from a pop-out looking connected.
#[test]
fn activity_does_not_overwrite_the_lifecycle() {
    let mut out = output(true);
    out.send_status(SessionStatus::Closed { code: 0 });
    out.send_status(SessionStatus::Activity { busy: true });

    let (data, _) = recording_channel(true);
    let (status, _) = status_channel(true);
    let snapshot = out.attach(data, status);
    assert_eq!(snapshot.status, "closed");
    assert!(snapshot.busy, "busy still travels, just separately");
}

#[test]
fn detach_drops_both_sinks() {
    let mut out = output(true);
    assert!(out.has_status_sink());
    out.detach();
    assert!(!out.has_status_sink());
}

/// The poller keys off this: a failed send while detached would otherwise make it discard and
/// rebuild the session's debounce state on every 500 ms tick.
#[test]
fn a_dead_status_sink_is_dropped_rather_than_retried() {
    let (data, _) = recording_channel(true);
    let (status, _) = status_channel(false);
    let mut out = Output::new(data, status, "cmd".into());

    out.send_status(SessionStatus::Activity { busy: true });
    assert!(!out.has_status_sink());
}
