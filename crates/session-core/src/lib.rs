//! Persistent terminal session daemon core. This crate deliberately has no Tauri dependency.

mod activity;
mod agent_activity;
mod client;
mod manager;
mod manifest;
mod output;
mod server;
mod scrollback;
mod summary;
mod transport;

pub use client::{SessionDaemonClient, SessionSubscription};
pub use manager::{AttachedSession, SessionManager};

pub fn flush_recovery_scrollback(manager: &SessionManager) -> Result<(), String> {
    scrollback::flush(manager)
}

pub fn run_daemon(state_dir: std::path::PathBuf) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("Could not start session daemon runtime: {error}"))?;
    runtime.block_on(server::run(state_dir))
}
