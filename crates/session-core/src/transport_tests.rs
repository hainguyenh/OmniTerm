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
