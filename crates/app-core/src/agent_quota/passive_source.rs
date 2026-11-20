//! Whether a profile reports its quota by itself, so the renderer need not freeze a freshly started
//! agent and type its usage command into the pane:
//!
//! - Claude: the status line bridge, installed here when it is missing (see
//!   claude_bridge_install.rs).
//! - Antigravity: its own status line bridge, installed the same way (agy_bridge_install.rs).
//! - Codex: the `rate_limits` it writes to its session log after every turn; nothing to install,
//!   so it counts once a log with a live window exists.
//!
//! The install never runs for a profile whose settings file is not valid JSON, or that the user
//! took the bridge out of in Settings; those, and launchers without a known folder, keep the inline
//! probe as their fallback.

use std::path::{Path, PathBuf};

use super::agy_bridge::{agy_cli_dir, agy_home};
use super::agy_bridge_install::{agy_bridge_status, install_agy_bridge};
use super::bridge_settings::is_declined;
use super::claude_bridge_install::{bridge_status, install_bridge, BridgeStatus};
use super::codex_rollout::fetch_codex_usage;
use super::deps::{Platform, ProviderDeps};
use super::types::{AgentKind, FetchUsageRequest};

/// Where the bridge would be installed and the app it reports to.
pub struct BridgeTarget<'a> {
    pub exe: &'a Path,
    pub app_settings: &'a Path,
    pub platform: Platform,
}

fn claude_dir(request: &FetchUsageRequest, home: &Path) -> Option<PathBuf> {
    match (&request.profile_dir, &request.launcher) {
        (Some(dir), _) => Some(dir.clone()),
        (None, None) => Some(home.join(AgentKind::Claude.default_dir())),
        (None, Some(_)) => None,
    }
}

/// Install when missing or pointing at another copy, unless the file is unreadable or declined.
fn ensure(
    status: BridgeStatus,
    declined: bool,
    install: impl FnOnce() -> std::io::Result<BridgeStatus>,
) -> bool {
    if status.current {
        return true;
    }
    if status.unreadable || declined {
        return false;
    }
    install().is_ok_and(|status| status.current)
}

pub fn ensure_passive_source(
    request: &FetchUsageRequest,
    target: &BridgeTarget,
    deps: &dyn ProviderDeps,
) -> bool {
    let BridgeTarget {
        exe,
        app_settings,
        platform,
    } = *target;
    match request.agent {
        AgentKind::Claude => {
            let Some(dir) = claude_dir(request, deps.home()) else {
                return false;
            };
            ensure(
                bridge_status(&dir, exe, platform),
                is_declined(&dir),
                || install_bridge(&dir, exe, app_settings, platform),
            )
        }
        AgentKind::Agy => {
            let launcher = request.launcher.as_deref();
            let Some(home) = agy_home(request.profile_dir.as_deref(), launcher, deps.home()) else {
                return false;
            };
            ensure(
                agy_bridge_status(&home, exe, platform),
                is_declined(&agy_cli_dir(&home)),
                || install_agy_bridge(&home, exe, platform),
            )
        }
        AgentKind::Codex => fetch_codex_usage(request.profile_dir.as_deref(), deps)
            .is_ok_and(|snapshot| snapshot.error.is_none() && !snapshot.windows.is_empty()),
    }
}

#[cfg(test)]
#[path = "passive_source_tests.rs"]
mod tests;
