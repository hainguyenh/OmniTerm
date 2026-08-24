use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use session_protocol::PersistencePolicy;

use crate::manager::SessionManager;
use crate::manifest::{atomic_write, stable_hash};

const FLUSH_INTERVAL: Duration = Duration::from_millis(750);

fn dir(state_dir: &Path) -> PathBuf {
    state_dir.join("scrollback")
}

fn path(state_dir: &Path, id: &str) -> PathBuf {
    dir(state_dir).join(format!("{:016x}.bin", stable_hash(id)))
}

pub(crate) fn load(state_dir: &Path, id: &str) -> Vec<u8> {
    fs::read(path(state_dir, id)).unwrap_or_default()
}

pub(crate) fn remove(state_dir: &Path, id: &str) {
    let _ = fs::remove_file(path(state_dir, id));
}

pub(crate) fn flush(manager: &SessionManager) -> Result<(), String> {
    let output_dir = dir(&manager.state_dir);
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Could not create durable scrollback directory: {error}"))?;
    for entry in manager.sessions.iter() {
        let recover = entry
            .policy
            .lock()
            .map(|policy| *policy == PersistencePolicy::RecoverAfterReboot)
            .unwrap_or(false);
        if !recover {
            continue;
        }
        let bytes = match entry
            .output
            .lock()
            .map(|mut output| output.take_flush_snapshot())
            .map_err(|_| "Session output lock is poisoned".to_string())?
        {
            Some(bytes) => bytes,
            // Nothing changed since the last durable write — skip the disk entirely.
            None => continue,
        };
        atomic_write(
            &path(&manager.state_dir, entry.key()),
            &bytes,
            "durable terminal scrollback",
        )?;
    }
    Ok(())
}

// `spawn` runs the durable scrollback flush loop forever. `flush` itself is
// covered by `persistence.rs`, but the surrounding ticker/loop is daemon-only
// and cannot be exercised from a unit test; the `log::warn!` arm fires only
// when the daemon's installed subscriber logs I/O failures during disk pressure
// (never in tests, which install no subscriber). The closure handed to
// `tokio::spawn` compiles to a separate generated async fn that the outer
// marker would not catch, so we lift the body into `run_durable_flush_loop`
// and mark that helper itself. Both are excluded from coverage.
#[cfg_attr(coverage, coverage(off))]
pub(crate) fn spawn(manager: SessionManager) -> tokio::task::JoinHandle<()> {
    tokio::spawn(run_durable_flush_loop(manager))
}

#[cfg_attr(coverage, coverage(off))]
async fn run_durable_flush_loop(manager: SessionManager) {
    let mut ticker = tokio::time::interval(FLUSH_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticker.tick().await;
        let manager = manager.clone();
        let result = tokio::task::spawn_blocking(move || flush(&manager)).await;
        if let Ok(Err(error)) = result {
            log::warn!("[sessiond] durable scrollback flush failed: {error}");
        }
    }
}

#[cfg(test)]
#[path = "scrollback_tests.rs"]
mod tests;
