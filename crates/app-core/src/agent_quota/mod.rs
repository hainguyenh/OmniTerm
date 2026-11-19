//! Agent Quota, the Tauri-free half: reading each AI agent's quota from its own CLI or logs,
//! waking a profile with a tiny prompt, and discovering the profiles a user can start.
//!
//! Nothing here reads a credential or talks to the network: the inputs are the agents' CLIs (or
//! the user's profile launchers), Codex's rollout logs, the reading Claude Code caches in its
//! profile config, and the quota Claude Code and the Antigravity CLI hand the OmniTerm status line
//! bridges. Unparsed output is an error, never zero usage, so it can never suspend an agent.

mod agy_bridge;
mod agy_bridge_install;
mod agy_provider;
mod agy_usage;
mod bridge_settings;
mod civil;
mod claude_bridge;
mod claude_bridge_install;
mod claude_bridge_run;
mod claude_provider;
mod claude_usage;
mod cli;
mod codex_rollout;
mod deps;
#[cfg(test)]
mod fake_deps;
mod iso_time;
mod launcher;
#[cfg(test)]
mod no_network_tests;
mod ordered_doc;
mod passive_source;
mod pattern;
mod profiles;
mod rate_windows;
mod reset;
mod service;
mod statusline_store;
mod system_deps;
mod terminal_text;
mod types;
mod wake;
mod zone;
#[cfg(any(not(windows), test))]
mod zone_tzif;

pub use agy_bridge_install::{
    agy_bridge_status, install_agy_bridge, remove_agy_bridge, run_agy_statusline_mode,
    AGY_STATUSLINE_FLAG,
};
pub use claude_bridge_install::{
    bridge_profile_dir, bridge_status, install_bridge, remove_bridge, BridgeStatus,
};
pub use claude_bridge_run::{run_guard_mode, run_statusline_mode, GUARD_FLAG, STATUSLINE_FLAG};
pub use deps::Platform;
pub use passive_source::BridgeTarget;
pub use service::{parse_fetch_request, parse_wake_request, QuotaService};
pub use statusline_store::read_statusline;
pub use system_deps::SystemDeps;
pub use types::{
    AgentKind, BreakdownEntry, DiscoveredProfile, FetchUsageRequest, ModelFamily, QuotaCredits,
    QuotaError, QuotaSnapshot, QuotaSource, QuotaWindow, WakeRequest, WakeResult, WindowKind,
};
