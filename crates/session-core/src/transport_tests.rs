use serde::{Deserialize, Serialize};
use tokio::io::{duplex, AsyncWriteExt};

use super::*;
use crate::io_failure_tests::FailingStream;

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct Frame {
    msg: String,
}

#[tokio::test]
async fn write_frame_and_read_frame_round_trip() {
    let (mut tx, mut rx) = duplex(8 * 1024);
    let sent = Frame {
        msg: "hello daemon".into(),
    };
    write_frame(&mut tx, &sent).await.unwrap();
    let got: Frame = read_frame(&mut rx).await.unwrap();
    assert_eq!(got, sent);
}

#[tokio::test]
async fn read_frame_rejects_zero_length() {
    let (mut tx, mut rx) = duplex(64);
    tx.write_u32(0).await.unwrap();
    let result: Result<Frame, String> = read_frame(&mut rx).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn read_frame_rejects_oversized_length() {
    let (mut tx, mut rx) = duplex(64);
    tx.write_u32((MAX_FRAME_BYTES + 1) as u32).await.unwrap();
    let result: Result<Frame, String> = read_frame(&mut rx).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn write_frame_rejects_oversized_payload() {
    let (mut tx, _rx) = duplex(64);
    // Vec<u8> serialises to a JSON integer array; 5 KB of bytes expands far
    // beyond MAX_FRAME_BYTES and triggers the write_frame size guard.
    let big = vec![b'a'; MAX_FRAME_BYTES + 1];
    let result = write_frame(&mut tx, &big).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn binary_output_frames_round_trip_and_json_frames_still_read() {
    let (mut tx, mut rx) = duplex(8 * 1024);
    write_data_frame(&mut tx, b"\x1b[31mred\x1b[0m")
        .await
        .unwrap();
    write_frame(&mut tx, &ServerMessage::Ok).await.unwrap();
    assert_eq!(
        read_server_message(&mut rx).await.unwrap(),
        ServerMessage::Data {
            data: b"\x1b[31mred\x1b[0m".to_vec()
        }
    );
    assert_eq!(
        read_server_message(&mut rx).await.unwrap(),
        ServerMessage::Ok
    );
}

#[tokio::test]
async fn binary_output_frames_reject_empty_and_oversized_bodies() {
    let (mut tx, mut rx) = duplex(64);
    assert!(write_data_frame(&mut tx, b"").await.is_err());
    tx.write_u32(0x8000_0000).await.unwrap();
    assert!(read_server_message(&mut rx).await.is_err());
}

#[tokio::test]
async fn read_frame_reports_a_missing_header_and_a_truncated_body() {
    let (tx, mut rx) = duplex(64);
    drop(tx);
    let missing: Result<Frame, String> = read_frame(&mut rx).await;
    assert!(missing
        .unwrap_err()
        .starts_with("Could not read daemon frame length"));

    let (mut tx, mut rx) = duplex(64);
    tx.write_u32(16).await.unwrap();
    tx.write_all(b"short").await.unwrap();
    drop(tx);
    let truncated: Result<Frame, String> = read_frame(&mut rx).await;
    assert!(truncated
        .unwrap_err()
        .starts_with("Could not read daemon frame:"));
}

#[tokio::test]
async fn read_frame_and_read_server_message_reject_invalid_json() {
    let (mut tx, mut rx) = duplex(64);
    tx.write_u32(3).await.unwrap();
    tx.write_all(b"{x}").await.unwrap();
    let frame: Result<Frame, String> = read_frame(&mut rx).await;
    assert!(frame.unwrap_err().starts_with("Invalid daemon message"));

    tx.write_u32(3).await.unwrap();
    tx.write_all(b"nop").await.unwrap();
    let message = read_server_message(&mut rx).await;
    assert!(message.unwrap_err().starts_with("Invalid daemon message"));
}

#[tokio::test]
async fn read_server_message_rejects_an_oversized_binary_frame() {
    let (mut tx, mut rx) = duplex(64);
    tx.write_u32(0x8000_0000 | (MAX_FRAME_BYTES as u32 + 1))
        .await
        .unwrap();
    let error = read_server_message(&mut rx).await.unwrap_err();
    assert_eq!(
        error,
        format!("Invalid daemon frame length: {}", MAX_FRAME_BYTES + 1)
    );
}

#[tokio::test]
async fn write_data_frame_rejects_oversized_output() {
    let mut stream = FailingStream::new(usize::MAX, false);
    let big = vec![0u8; MAX_FRAME_BYTES + 1];
    let error = write_data_frame(&mut stream, &big).await.unwrap_err();
    assert_eq!(
        error,
        format!("Invalid output frame: {} bytes", MAX_FRAME_BYTES + 1)
    );
    assert!(stream.written.is_empty());
}

#[tokio::test]
async fn write_data_frame_reports_each_failing_write_stage() {
    let mut stream = FailingStream::new(0, false);
    let error = write_data_frame(&mut stream, b"out").await.unwrap_err();
    assert!(error.starts_with("Could not write daemon frame length"));

    let mut stream = FailingStream::new(4, false);
    let error = write_data_frame(&mut stream, b"out").await.unwrap_err();
    assert!(error.starts_with("Could not write daemon frame:"));

    let mut stream = FailingStream::new(usize::MAX, true);
    let error = write_data_frame(&mut stream, b"out").await.unwrap_err();
    assert!(error.starts_with("Could not flush daemon frame"));
    assert_eq!(&stream.written[4..], b"out");
}

#[tokio::test]
async fn write_frame_reports_each_failing_write_stage() {
    let sent = Frame { msg: "x".into() };
    let mut stream = FailingStream::new(0, false);
    let error = write_frame(&mut stream, &sent).await.unwrap_err();
    assert!(error.starts_with("Could not write daemon frame length"));

    let mut stream = FailingStream::new(4, false);
    let error = write_frame(&mut stream, &sent).await.unwrap_err();
    assert!(error.starts_with("Could not write daemon frame:"));

    let mut stream = FailingStream::new(usize::MAX, true);
    let error = write_frame(&mut stream, &sent).await.unwrap_err();
    assert!(error.starts_with("Could not flush daemon frame"));
}

#[tokio::test]
async fn write_frame_reports_values_json_cannot_encode() {
    // JSON object keys must be strings, so a map keyed by tuples fails to serialise.
    let unencodable = std::collections::BTreeMap::from([((1u8, 2u8), 3u8)]);
    let mut stream = FailingStream::new(usize::MAX, false);
    let error = write_frame(&mut stream, &unencodable).await.unwrap_err();
    assert!(error.contains("key must be a string"), "{error}");
    assert!(stream.written.is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn connect_reports_a_missing_daemon_socket() {
    let dir = tempfile::tempdir().unwrap();
    let error = match connect(dir.path()).await {
        Ok(_) => panic!("no daemon listens in a fresh directory"),
        Err(error) => error,
    };
    assert!(error.starts_with("Could not connect to OmniTerm session daemon"));
}

#[cfg(windows)]
#[tokio::test]
async fn connect_reports_a_missing_daemon_pipe() {
    let dir = tempfile::tempdir().unwrap();
    let error = match connect(dir.path()).await {
        Ok(_) => panic!("no daemon listens on a fresh pipe name"),
        Err(error) => error,
    };
    assert!(error.starts_with("Could not connect to OmniTerm session daemon"));
}
