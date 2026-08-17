use std::path::Path;
#[cfg(unix)]
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::Serialize;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;

pub(crate) trait AsyncStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T> AsyncStream for T where T: AsyncRead + AsyncWrite + Unpin + Send {}

pub(crate) type BoxedStream = Box<dyn AsyncStream>;

pub(crate) async fn read_frame<T: DeserializeOwned>(
    stream: &mut dyn AsyncStream,
) -> Result<T, String> {
    let len = stream
        .read_u32()
        .await
        .map_err(|error| format!("Could not read daemon frame length: {error}"))? as usize;
    if len == 0 || len > MAX_FRAME_BYTES {
        return Err(format!("Invalid daemon frame length: {len}"));
    }
    let mut bytes = vec![0u8; len];
    stream
        .read_exact(&mut bytes)
        .await
        .map_err(|error| format!("Could not read daemon frame: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("Invalid daemon message: {error}"))
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
        let stream = tokio::net::windows::named_pipe::ClientOptions::new()
            .open(endpoint_name(state_dir))
            .map_err(|error| format!("Could not connect to OmniTerm session daemon: {error}"))?;
        Ok(Box::new(stream))
    }
}
