use std::path::Path;
#[cfg(unix)]
use std::path::PathBuf;
#[cfg(windows)]
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Serialize;
use session_protocol::ServerMessage;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;
#[cfg(windows)]
const PIPE_BUSY_OS_ERROR: i32 = 231;
#[cfg(windows)]
const PIPE_BUSY_RETRY_DELAY: Duration = Duration::from_millis(20);
#[cfg(windows)]
const PIPE_BUSY_RETRY_TIMEOUT: Duration = Duration::from_secs(2);

pub(crate) trait AsyncStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T> AsyncStream for T where T: AsyncRead + AsyncWrite + Unpin + Send {}

pub(crate) type BoxedStream = Box<dyn AsyncStream>;

/// Set in a frame's length word for a raw terminal-output frame: the body is the output bytes
/// themselves, not JSON (a JSON number array costs about four bytes per output byte). JSON frames
/// never reach this bit, since their length is capped at [`MAX_FRAME_BYTES`].
const BINARY_DATA_FLAG: u32 = 0x8000_0000;

async fn read_header(stream: &mut dyn AsyncStream) -> Result<u32, String> {
    stream
        .read_u32()
        .await
        .map_err(|error| format!("Could not read daemon frame length: {error}"))
}

async fn read_body(stream: &mut dyn AsyncStream, len: usize) -> Result<Vec<u8>, String> {
    if len == 0 || len > MAX_FRAME_BYTES {
        return Err(format!("Invalid daemon frame length: {len}"));
    }
    let mut bytes = vec![0u8; len];
    stream
        .read_exact(&mut bytes)
        .await
        .map_err(|error| format!("Could not read daemon frame: {error}"))?;
    Ok(bytes)
}

pub(crate) async fn read_frame<T: DeserializeOwned>(
    stream: &mut dyn AsyncStream,
) -> Result<T, String> {
    let len = read_header(stream).await? as usize;
    let bytes = read_body(stream, len).await?;
    serde_json::from_slice(&bytes).map_err(|error| format!("Invalid daemon message: {error}"))
}

/// The next message of an attached session's stream, as JSON or as a raw output frame.
pub(crate) async fn read_server_message(
    stream: &mut dyn AsyncStream,
) -> Result<ServerMessage, String> {
    let header = read_header(stream).await?;
    if header & BINARY_DATA_FLAG != 0 {
        let data = read_body(stream, (header & !BINARY_DATA_FLAG) as usize).await?;
        return Ok(ServerMessage::Data { data });
    }
    let bytes = read_body(stream, header as usize).await?;
    serde_json::from_slice(&bytes).map_err(|error| format!("Invalid daemon message: {error}"))
}

/// Terminal output as one raw frame, for a client that asked for binary data.
pub(crate) async fn write_data_frame(
    stream: &mut dyn AsyncStream,
    data: &[u8],
) -> Result<(), String> {
    if data.is_empty() || data.len() > MAX_FRAME_BYTES {
        return Err(format!("Invalid output frame: {} bytes", data.len()));
    }
    stream
        .write_u32(BINARY_DATA_FLAG | data.len() as u32)
        .await
        .map_err(|error| format!("Could not write daemon frame length: {error}"))?;
    stream
        .write_all(data)
        .await
        .map_err(|error| format!("Could not write daemon frame: {error}"))?;
    stream
        .flush()
        .await
        .map_err(|error| format!("Could not flush daemon frame: {error}"))
}

pub(crate) async fn write_frame<T: Serialize>(
    stream: &mut dyn AsyncStream,
    value: &T,
) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_FRAME_BYTES {
        return Err(format!("Daemon frame is too large: {} bytes", bytes.len()));
    }
    stream
        .write_u32(bytes.len() as u32)
        .await
        .map_err(|error| format!("Could not write daemon frame length: {error}"))?;
    stream
        .write_all(&bytes)
        .await
        .map_err(|error| format!("Could not write daemon frame: {error}"))?;
    stream
        .flush()
        .await
        .map_err(|error| format!("Could not flush daemon frame: {error}"))
}

#[cfg(unix)]
pub(crate) fn endpoint_path(state_dir: &Path) -> PathBuf {
    state_dir.join("sessiond.sock")
}

#[cfg(windows)]
fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg(windows)]
fn pipe_busy_retry_delay(error: &std::io::Error, elapsed: Duration) -> Option<Duration> {
    (error.raw_os_error() == Some(PIPE_BUSY_OS_ERROR) && elapsed < PIPE_BUSY_RETRY_TIMEOUT)
        .then_some(PIPE_BUSY_RETRY_DELAY)
}

#[cfg(windows)]
pub(crate) fn endpoint_name(state_dir: &Path) -> String {
    let path = state_dir.to_string_lossy();
    format!(r"\\.\pipe\omniterm-sessiond-{:016x}", stable_hash(&path))
}

pub(crate) async fn connect(state_dir: &Path) -> Result<BoxedStream, String> {
    #[cfg(unix)]
    {
        let stream = tokio::net::UnixStream::connect(endpoint_path(state_dir))
            .await
            .map_err(|error| format!("Could not connect to OmniTerm session daemon: {error}"))?;
        Ok(Box::new(stream))
    }
    #[cfg(windows)]
    {
        let name = endpoint_name(state_dir);
        let started = tokio::time::Instant::now();
        loop {
            match tokio::net::windows::named_pipe::ClientOptions::new().open(&name) {
                Ok(stream) => return Ok(Box::new(stream)),
                Err(error) => {
                    let Some(delay) = pipe_busy_retry_delay(&error, started.elapsed()) else {
                        return Err(format!(
                            "Could not connect to OmniTerm session daemon: {error}"
                        ));
                    };
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "transport_tests.rs"]
mod transport_tests;

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;

    #[tokio::test]
    async fn connect_waits_for_a_new_pipe_instance_when_all_instances_are_busy() {
        use tokio::net::windows::named_pipe::{ClientOptions, ServerOptions};

        let unique = format!(
            "omniterm-pipe-busy-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock must be after Unix epoch")
                .as_nanos()
        );
        let state_dir = std::path::PathBuf::from(unique);
        let name = endpoint_name(&state_dir);
        let first_server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&name)
            .expect("first server instance");
        let _first_client = ClientOptions::new().open(&name).expect("first client");
        first_server
            .connect()
            .await
            .expect("first server connection");

        let busy = match ClientOptions::new().open(&name) {
            Ok(_) => panic!("opening without a free server instance must be busy"),
            Err(error) => error,
        };
        assert_eq!(busy.raw_os_error(), Some(PIPE_BUSY_OS_ERROR));

        let pending = tokio::spawn(async move { connect(&state_dir).await });
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert!(
            !pending.is_finished(),
            "busy connection must wait instead of failing"
        );

        let _second_server = ServerOptions::new()
            .create(&name)
            .expect("second server instance");
        let connected = tokio::time::timeout(Duration::from_secs(1), pending)
            .await
            .expect("client retry must connect before timeout")
            .expect("connect task must not panic");
        assert!(
            connected.is_ok(),
            "client retry must succeed once an instance is free"
        );
    }

    #[test]
    fn only_pipe_busy_is_retried_and_only_inside_the_deadline() {
        let busy = std::io::Error::from_raw_os_error(PIPE_BUSY_OS_ERROR);
        let denied = std::io::Error::from_raw_os_error(5);
        assert_eq!(
            pipe_busy_retry_delay(&busy, Duration::ZERO),
            Some(PIPE_BUSY_RETRY_DELAY)
        );
        assert_eq!(pipe_busy_retry_delay(&busy, PIPE_BUSY_RETRY_TIMEOUT), None);
        assert_eq!(pipe_busy_retry_delay(&denied, Duration::ZERO), None);
    }
}
