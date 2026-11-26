use session_protocol::{DaemonStatus, ServerMessage};
use tokio::io::duplex;
use tokio::sync::broadcast;

use super::*;
use crate::io_failure_tests::FailingStream;
use crate::transport::read_server_message;

fn data(bytes: &[u8]) -> ServerMessage {
    ServerMessage::Data {
        data: bytes.to_vec(),
    }
}

fn status() -> ServerMessage {
    ServerMessage::Status {
        status: DaemonStatus::Activity { busy: true },
    }
}

#[test]
fn queued_output_is_joined_in_order_and_a_status_ends_the_run() {
    let (tx, mut rx) = broadcast::channel(16);
    tx.send(data(b"b")).unwrap();
    tx.send(data(b"c")).unwrap();
    tx.send(status()).unwrap();
    tx.send(data(b"d")).unwrap();
    let (joined, after) = coalesce(data(b"a"), &mut rx);
    assert_eq!(joined, data(b"abc"));
    assert_eq!(after, After::Message(status()));
    // The output after the status is the next run.
    let (rest, after) = coalesce(rx.try_recv().unwrap(), &mut rx);
    assert_eq!(rest, data(b"d"));
    assert_eq!(after, After::Nothing);
}

#[test]
fn quiet_output_and_statuses_pass_through_alone() {
    let (_tx, mut rx) = broadcast::channel::<ServerMessage>(4);
    assert_eq!(coalesce(data(b"x"), &mut rx), (data(b"x"), After::Nothing));
    assert_eq!(coalesce(status(), &mut rx), (status(), After::Nothing));
}

#[test]
fn a_run_stops_at_the_size_limit_without_dropping_bytes() {
    let (tx, mut rx) = broadcast::channel(16);
    let half = vec![b'x'; COALESCE_LIMIT / 2];
    tx.send(data(&half)).unwrap();
    tx.send(data(b"overflow")).unwrap();
    let (joined, after) = coalesce(data(&half), &mut rx);
    let ServerMessage::Data { data: joined } = joined else {
        panic!("expected output")
    };
    assert_eq!(joined.len(), COALESCE_LIMIT);
    // A full frame goes out at once; the rest waits in the stream for the next run.
    assert_eq!(after, After::Nothing);
    assert_eq!(rx.try_recv().unwrap(), data(b"overflow"));

    // Output that would overflow a partial frame starts the next one.
    tx.send(data(&half)).unwrap();
    let (joined, after) = coalesce(data(&vec![b'y'; COALESCE_LIMIT / 2 + 1]), &mut rx);
    let ServerMessage::Data { data: joined } = joined else {
        panic!("expected output")
    };
    assert_eq!(joined.len(), COALESCE_LIMIT / 2 + 1);
    assert_eq!(after, After::Message(data(&half)));
}

#[test]
fn a_closed_or_lagging_stream_is_reported_after_the_joined_output() {
    let (tx, mut rx) = broadcast::channel(16);
    drop(tx);
    assert_eq!(coalesce(data(b"a"), &mut rx), (data(b"a"), After::Closed));

    let (tx, mut rx) = broadcast::channel(2);
    for byte in [b"1", b"2", b"3"] {
        tx.send(data(byte)).unwrap();
    }
    assert_eq!(coalesce(data(b"0"), &mut rx).1, After::Lagged);
}

async fn forwarded(binary: bool) -> Vec<ServerMessage> {
    let (tx, rx) = broadcast::channel(16);
    tx.send(data(b"hello ")).unwrap();
    tx.send(data(b"world")).unwrap();
    tx.send(status()).unwrap();
    drop(tx);
    let (mut client, mut server) = duplex(64 * 1024);
    forward(&mut server, rx, binary).await;
    drop(server);
    let mut out = Vec::new();
    while let Ok(message) = read_server_message(&mut client).await {
        out.push(message);
    }
    out
}

#[tokio::test]
async fn forwarding_sends_joined_output_as_binary_or_json_frames() {
    let expected = vec![data(b"hello world"), status()];
    assert_eq!(forwarded(true).await, expected);
    // A client that did not ask for binary frames (an older app) gets the same messages as JSON.
    assert_eq!(forwarded(false).await, expected);
}

#[tokio::test]
async fn a_client_that_fell_behind_is_told_to_reattach() {
    let (tx, rx) = broadcast::channel(2);
    for byte in [b"1", b"2", b"3"] {
        tx.send(data(byte)).unwrap();
    }
    let (mut client, mut server) = duplex(64 * 1024);
    forward(&mut server, rx, true).await;
    drop(server);
    assert_eq!(
        read_server_message(&mut client).await.unwrap(),
        ServerMessage::Error {
            message: LAGGED_MESSAGE.to_string()
        }
    );
    assert!(read_server_message(&mut client).await.is_err());
}

#[tokio::test]
async fn forwarding_stops_when_the_client_cannot_take_the_output() {
    let (tx, rx) = broadcast::channel(16);
    tx.send(data(b"lost")).unwrap();
    let mut stream = FailingStream::new(0, false);
    // The sender stays open: only the write failure can end the forward loop.
    forward(&mut stream, rx, true).await;
    assert!(stream.written.is_empty());
    drop(tx);
}

#[tokio::test]
async fn forwarding_stops_when_the_status_after_output_cannot_be_sent() {
    let (tx, rx) = broadcast::channel(16);
    tx.send(data(b"out")).unwrap();
    tx.send(status()).unwrap();
    // Room for exactly the binary output frame (4-byte header + 3 bytes), none for the status.
    let mut stream = FailingStream::new(7, false);
    forward(&mut stream, rx, true).await;
    assert_eq!(&stream.written[4..], b"out");
    drop(tx);
}
