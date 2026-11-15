//! Agent Quota, the Tauri-free half: reading each AI agent's quota from its own CLI or logs,
//! waking a profile with a tiny prompt, and discovering the profiles a user can start.
//!
//! Nothing here reads a credential or talks to the network: the inputs are the agents' CLIs (or
//! the user's profile launchers), Codex's rollout logs and the reading Claude Code caches in its
//! profile config. Unparsed output is an error, never zero usage, so it can never suspend an agent.

mod agy_provider;
mod agy_usage;
mod civil;
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
mod pattern;
mod profiles;
mod rate_windows;
mod reset;
mod service;
mod system_deps;
mod terminal_text;
mod types;
mod wake;
mod zone;
#[cfg(any(not(windows), test))]
mod zone_tzif;

pub use service::{parse_fetch_request, parse_wake_request, QuotaService};
pub use system_deps::SystemDeps;
pub use types::{
    AgentKind, BreakdownEntry, DiscoveredProfile, FetchUsageRequest, ModelFamily, QuotaCredits,
    QuotaError, QuotaSnapshot, QuotaSource, QuotaWindow, WakeRequest, WakeResult, WindowKind,
};
