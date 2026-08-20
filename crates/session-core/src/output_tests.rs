use std::time::Duration;

use super::*;

#[test]
fn push_stores_data_and_broadcasts() {
    let mut output = Output::new("test".into(), false);
    let mut rx = output.stream.subscribe();
    output.push(b"hello");
    assert_eq!(output.replay(), b"hello");
    let messages: Vec<_> = std::iter::repeat_with(|| rx.try_recv())
        .take_while(Result::is_ok)
        .map(Result::unwrap)
        .collect();
    assert!(messages.iter().any(|msg| matches!(
        msg,
        ServerMessage::Data { data } if data == b"hello"
    )));
}

#[test]
fn seed_buffer_is_replayable() {
    let mut output = Output::new("test".into(), false);
    output.seed(b"preloaded");
    assert_eq!(output.replay(), b"preloaded");
}

#[test]
fn trim_drops_oldest_data_above_cap() {
    let mut output = Output::new("test".into(), false);
    let fill = vec![b'x'; BUFFER_CAP + 100];
    output.seed(&fill);
    output.push(b"tail");
    let replayed = output.replay();
    assert!(replayed.len() <= BUFFER_CAP + 4);
    assert!(replayed.ends_with(b"tail"));
}

#[test]
fn trim_stops_at_a_newline_boundary_when_one_is_inside_the_scan_window() {
    let mut output = Output::new("test".into(), false);
    // The drop point is decided before the scan; place a newline exactly at
    // that position so `trim` takes the "found a line boundary" branch and
    // drains up to it instead of scanning the full window.
    let mut seed = vec![b'a'; BUFFER_CAP];
    seed[1] = b'\n';
    seed.push(b'b');
    output.seed(&seed);
    output.push(b"tail");
    let replayed = output.replay();
    assert!(replayed.len() <= BUFFER_CAP);
    assert_eq!(replayed[0], b'a');
    assert!(replayed.ends_with(b"tail"));
}

#[test]
fn status_sets_busy_flag_and_broadcasts() {
    let mut output = Output::new("test".into(), false);
    assert!(!output.busy());
    output.status(DaemonStatus::Activity { busy: true });
    assert!(output.busy());
    output.status(DaemonStatus::Activity { busy: false });
    assert!(!output.busy());
}

#[test]
fn status_ready_updates_label() {
    let mut output = Output::new("test".into(), false);
    output.status(DaemonStatus::Ready {
        label: "new-label".into(),
    });
    let snapshot = output.snapshot(1);
    assert_eq!(snapshot.status, "ready");
    assert_eq!(snapshot.label.as_deref(), Some("new-label"));
}

#[test]
fn status_error_records_message() {
    let mut output = Output::new("test".into(), false);
    output.status(DaemonStatus::Error {
        message: "boom".into(),
    });
    let snapshot = output.snapshot(1);
    assert_eq!(snapshot.status, "error");
    assert_eq!(snapshot.error.as_deref(), Some("boom"));
}

#[test]
fn status_closed_marks_snapshot() {
    let mut output = Output::new("test".into(), false);
    output.status(DaemonStatus::Closed { code: 42 });
    let snapshot = output.snapshot(1);
    assert_eq!(snapshot.status, "closed");
}

#[test]
fn note_input_then_agent_activity_reflects_state() {
    let mut output = Output::new("test".into(), false);
    output.push(b"\x1b]0;Claude Code\x07");
    output.note_input();
    let sample = output.agent_activity();
    assert!(sample.is_agent);
    assert!(sample.recent_input);
}

#[test]
fn attach_returns_replay_and_subscribes_to_stream() {
    let mut output = Output::new("test".into(), false);
    output.seed(b"persisted");
    let (snapshot, replay, mut rx) = output.attach(7);
    assert_eq!(snapshot.generation, 7);
    assert_eq!(replay, b"persisted");
    output.push(b"live");
    let msg = rx.try_recv().unwrap();
    assert!(matches!(msg, ServerMessage::Data { data } if data == b"live"));
}

#[test]
fn snapshot_captures_generation_and_busy() {
    let output = Output::new("test".into(), true);
    let snapshot = output.snapshot(42);
    assert_eq!(snapshot.generation, 42);
    assert!(snapshot.busy);
    assert_eq!(snapshot.status, "ready");
    assert_eq!(snapshot.label.as_deref(), Some("test"));
}

struct ErrorReader;

impl Read for ErrorReader {
    fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
        Err(std::io::Error::other("simulated pty failure"))
    }
}

#[tokio::test]
async fn spawn_reader_pushes_data_into_output_buffer() {
    let output = Arc::new(Mutex::new(Output::new("test".into(), false)));
    let lifecycle = Arc::new(Mutex::new(SessionLifecycle::Live));
    let reader: Box<dyn Read + Send> = Box::new(std::io::Cursor::new(b"hello world".to_vec()));
    spawn_reader(reader, Arc::clone(&output), Arc::clone(&lifecycle));
    tokio::time::sleep(Duration::from_millis(100)).await;
    let replay = output.lock().unwrap().replay();
    assert_eq!(replay, b"hello world");
}

#[tokio::test]
async fn spawn_reader_marks_error_on_read_failure() {
    let output = Arc::new(Mutex::new(Output::new("test".into(), false)));
    let lifecycle = Arc::new(Mutex::new(SessionLifecycle::Live));
    let reader: Box<dyn Read + Send> = Box::new(ErrorReader);
    spawn_reader(reader, Arc::clone(&output), Arc::clone(&lifecycle));
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(*lifecycle.lock().unwrap(), SessionLifecycle::Error);
    let snapshot = output.lock().unwrap().snapshot(1);
    assert_eq!(snapshot.status, "error");
}
