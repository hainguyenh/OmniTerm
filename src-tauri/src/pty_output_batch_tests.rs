//! What the renderer depends on: fewer messages, in read order, and none lost at shutdown.

use super::*;
use crate::pty::SessionStatus;
use tauri::ipc::{Channel, InvokeResponseBody};

/// Records each message the sink receives, so a test can count them as well as check the bytes.
type Received = Arc<Mutex<Vec<Vec<u8>>>>;

fn output_with_log() -> (Arc<Mutex<Output>>, Received) {
    let log: Received = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&log);
    let data = Channel::new(move |body: InvokeResponseBody| {
        if let InvokeResponseBody::Raw(bytes) = body {
            sink.lock().unwrap().push(bytes);
        }
        Ok(())
    });
    let status = Channel::new(|_: InvokeResponseBody| Ok(()));
    let output = Arc::new(Mutex::new(Output::new(
        data,
        status,
        "PowerShell".to_string(),
    )));
    // Ready is recorded on the status channel, not the data one, so it cannot pollute the log.
    crate::session_output::send_status(&output, SessionStatus::Ready { label: "sh".into() });
    (output, log)
}

/// The point of the module: a burst of small reads becomes far fewer messages than reads, with every
/// byte intact and in order.
#[test]
fn coalesces_a_burst_of_reads_into_fewer_messages() {
    let (output, log) = output_with_log();
    let batcher = OutputBatcher::spawn(Arc::clone(&output));

    for i in 0..200u32 {
        batcher.push(format!("{i},").as_bytes());
    }
    batcher.finish();

    let messages = log.lock().unwrap();
    let expected: String = (0..200u32).map(|i| format!("{i},")).collect();
    assert_eq!(String::from_utf8(messages.concat()).unwrap(), expected);
    assert!(
        messages.len() < 200,
        "expected coalescing, got {} messages for 200 pushes",
        messages.len()
    );
}

/// A prompt's keystroke echo must not wait for a 64 KiB batch that will never arrive.
#[test]
fn a_lone_chunk_is_delivered_without_waiting_for_more() {
    let (output, log) = output_with_log();
    let batcher = OutputBatcher::spawn(Arc::clone(&output));

    batcher.push(b"x");
    // Comfortably past FLUSH_INTERVAL, but far short of any wall-clock a size-based flush would need.
    thread::sleep(FLUSH_INTERVAL * 10);

    assert_eq!(log.lock().unwrap().concat(), b"x");
    batcher.finish();
}

/// `finish` is what keeps a script's last line ahead of the `Closed` status the exit path sends next.
#[test]
fn finish_drains_everything_still_pending() {
    let (output, log) = output_with_log();
    let batcher = OutputBatcher::spawn(Arc::clone(&output));

    batcher.push(b"first");
    batcher.push(b"second");
    batcher.finish();

    assert_eq!(log.lock().unwrap().concat(), b"firstsecond");
}

/// Once a batch is big enough there is nothing to gain by holding it, so it goes early.
#[test]
fn flushes_early_once_the_batch_is_large() {
    let (output, log) = output_with_log();
    let batcher = OutputBatcher::spawn(Arc::clone(&output));

    let chunk = vec![b'z'; 8 * 1024];
    for _ in 0..16 {
        batcher.push(&chunk);
    }
    batcher.finish();

    let messages = log.lock().unwrap();
    assert_eq!(messages.concat().len(), 16 * 8 * 1024);
    assert!(
        messages.iter().all(|m| m.len() <= FLUSH_BYTES + chunk.len()),
        "no message should overshoot the size trigger by more than one chunk"
    );
}

/// The Drop backstop: a reader that panics must not leave the batcher thread parked on `recv`.
#[test]
fn dropping_the_batcher_stops_its_thread_and_flushes() {
    let (output, log) = output_with_log();
    {
        let batcher = OutputBatcher::spawn(Arc::clone(&output));
        batcher.push(b"panicked mid-read");
    }
    assert_eq!(log.lock().unwrap().concat(), b"panicked mid-read");
}
