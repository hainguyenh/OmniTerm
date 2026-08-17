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
        let bytes = entry
            .output
            .lock()
            .map(|output| output.replay())
            .map_err(|_| "Session output lock is poisoned".to_string())?;
        atomic_write(
            &path(&manager.state_dir, entry.key()),
            &bytes,
            "durable terminal scrollback",
        )?;
    }
    Ok(())
}

pub(crate) fn spawn(manager: SessionManager) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
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
    })
}
