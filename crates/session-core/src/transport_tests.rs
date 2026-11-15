use serde::{Deserialize, Serialize};
use tokio::io::{duplex, AsyncWriteExt};

use super::*;

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
