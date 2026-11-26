//! Streams an attached session's output and status to one client.

use session_protocol::ServerMessage;
use tokio::sync::broadcast::{self, error::TryRecvError};

use crate::transport::{write_data_frame, write_frame, AsyncStream};

/// A burst of output is sent as frames of up to this many bytes instead of one per PTY read.
pub(crate) const COALESCE_LIMIT: usize = 64 * 1024;

const LAGGED_MESSAGE: &str = "Session stream fell behind; reattach to replay buffered output.";

/// What follows a coalesced message in the stream.
#[derive(Debug, PartialEq)]
pub(crate) enum After {
    /// Nothing queued right now.
    Nothing,
    /// The next message, which could not join the first (a status, or output past the limit).
    Message(ServerMessage),
    Lagged,
    Closed,
}

/// Joins the output already queued behind `first` into it, up to [`COALESCE_LIMIT`] bytes. Only
/// messages that are waiting are taken, so a quiet session's output is never held back; under
/// load (a build log, `cat` of a big file) many small reads go out as one frame. Byte order is
/// kept: a status message ends the run and is returned to be sent right after.
pub(crate) fn coalesce(
    first: ServerMessage,
    receiver: &mut broadcast::Receiver<ServerMessage>,
) -> (ServerMessage, After) {
    let ServerMessage::Data { mut data } = first else {
        return (first, After::Nothing);
    };
    loop {
        if data.len() >= COALESCE_LIMIT {
            return (ServerMessage::Data { data }, After::Nothing);
        }
        match receiver.try_recv() {
            Ok(ServerMessage::Data { data: more }) if data.len() + more.len() <= COALESCE_LIMIT => {
                data.extend_from_slice(&more);
            }
            Ok(next) => return (ServerMessage::Data { data }, After::Message(next)),
            Err(TryRecvError::Empty) => return (ServerMessage::Data { data }, After::Nothing),
            Err(TryRecvError::Lagged(_)) => return (ServerMessage::Data { data }, After::Lagged),
            Err(TryRecvError::Closed) => return (ServerMessage::Data { data }, After::Closed),
        }
    }
}

async fn send(
    stream: &mut dyn AsyncStream,
    message: &ServerMessage,
    binary: bool,
) -> Result<(), String> {
    match message {
        ServerMessage::Data { data } if binary => write_data_frame(stream, data).await,
        _ => write_frame(stream, message).await,
    }
}

async fn send_lagged(stream: &mut dyn AsyncStream) {
    let message = ServerMessage::Error {
        message: LAGGED_MESSAGE.to_string(),
    };
    let _ = write_frame(stream, &message).await;
}

/// Forwards the session's messages until the client goes away or the session ends.
pub(crate) async fn forward(
    stream: &mut dyn AsyncStream,
    mut receiver: broadcast::Receiver<ServerMessage>,
    binary: bool,
) {
    loop {
        let message = match receiver.recv().await {
            Ok(message) => message,
            Err(broadcast::error::RecvError::Lagged(_)) => return send_lagged(stream).await,
            Err(broadcast::error::RecvError::Closed) => return,
        };
        let (message, after) = coalesce(message, &mut receiver);
        if send(stream, &message, binary).await.is_err() {
            return;
        }
        match after {
            After::Nothing => {}
            After::Message(next) => {
                if send(stream, &next, binary).await.is_err() {
                    return;
                }
            }
            After::Lagged => return send_lagged(stream).await,
            After::Closed => return,
        }
    }
}

#[cfg(test)]
#[path = "forward_tests.rs"]
mod tests;
