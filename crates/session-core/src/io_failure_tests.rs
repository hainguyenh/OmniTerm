//! In-memory stream for exercising transport write failures in unit tests.

use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};

use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

/// Accepts up to `budget` bytes, then fails every write; can also fail on flush. Reads drain
/// `input`, then report end of stream.
pub(crate) struct FailingStream {
    pub(crate) budget: usize,
    pub(crate) fail_flush: bool,
    pub(crate) written: Vec<u8>,
    pub(crate) input: Vec<u8>,
}

impl FailingStream {
    pub(crate) fn new(budget: usize, fail_flush: bool) -> Self {
        Self {
            budget,
            fail_flush,
            written: Vec::new(),
            input: Vec::new(),
        }
    }

    /// A stream that delivers `request` as one frame and refuses every write.
    pub(crate) async fn reading<T: serde::Serialize>(request: &T) -> Self {
        let mut framed = Self::new(usize::MAX, false);
        crate::transport::write_frame(&mut framed, request)
            .await
            .expect("request must encode");
        let mut stream = Self::new(0, false);
        stream.input = framed.written;
        stream
    }
}

impl AsyncRead for FailingStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let taken = buf.remaining().min(self.input.len());
        buf.put_slice(&self.input[..taken]);
        self.input.drain(..taken);
        Poll::Ready(Ok(()))
    }
}

impl AsyncWrite for FailingStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        if self.budget == 0 {
            return Poll::Ready(Err(io::Error::new(io::ErrorKind::BrokenPipe, "closed")));
        }
        let accepted = buf.len().min(self.budget);
        self.budget -= accepted;
        self.written.extend_from_slice(&buf[..accepted]);
        Poll::Ready(Ok(accepted))
    }

    fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if self.fail_flush {
            return Poll::Ready(Err(io::Error::other("flush failed")));
        }
        Poll::Ready(Ok(()))
    }

    fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}
