//! Persistent terminal session daemon core. This crate deliberately has no Tauri dependency.

// Enable the unstable `coverage_attribute` feature only under the coverage build,
// so `#[cfg_attr(coverage, coverage(off))]` markers can exclude code that is
// genuinely uncoverable (daemon main loops, broadcast back-pressure arms) while
// leaving stable builds untouched. The coverage build sets `--cfg coverage` for
// the workspace via `scripts/run-rust-coverage.mjs`; this cfg is absent for
// ordinary `cargo build`/`cargo test`, so the feature gate expands to nothing.
#![cfg_attr(coverage, feature(coverage_attribute))]

mod activity;
mod agent_activity;
mod client;
mod exit_watcher;
mod freeze;
mod manager;
mod manifest;
mod output;
mod scrollback;
mod server;
mod summary;
mod suspend;
mod transport;

pub use client::{SessionDaemonClient, SessionSubscription};
pub use manager::{AttachedSession, SessionManager};

pub fn flush_recovery_scrollback(manager: &SessionManager) -> Result<(), String> {
    scrollback::flush(manager)
}

// `run_daemon` blocks the calling thread for the lifetime of the daemon's
// accept loop, so the `block_on` call never returns and the trailing `?`
// / `runtime` lines cannot complete under the profiler. The init path is
// exercised indirectly by `tests/client_daemon.rs`; the tail is excluded so
// the running count does not penalize a deliberately-never-terminating entry
// point.
#[cfg_attr(coverage, coverage(off))]
pub fn run_daemon(state_dir: std::path::PathBuf) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("Could not start session daemon runtime: {error}"))?;
    runtime.block_on(server::run(state_dir))
}
