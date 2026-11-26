//! Profile launchers and how an agent is run for a profile.
//!
//! A profile launcher is a small script the user runs instead of the agent, such as
//! `claude-th.cmd` setting `CLAUDE_CONFIG_DIR` before starting `claude.exe`. Probing and waking
//! through the same launcher reproduces exactly how the user runs that profile — including
//! launchers whose directory does not follow the name (`claude-he` → `~/.claude-he`).
//!
//! Only a bare name crosses the IPC boundary. It must look like `claude-<x>` / `codex-<x>` /
//! `agy-<x>` and is resolved here from the user's own bin directory and PATH, so the renderer can
//! never make the app run an arbitrary file.

use std::path::{Path, PathBuf};

use super::cli::profile_env;
use super::deps::{Env, ProviderDeps};
use super::types::AgentKind;

/// `^(claude|codex|agy)-[A-Za-z0-9_.]{1,40}$`, for this agent, and never `agy-gemini`.
pub fn is_launcher_name(name: &str, agent: AgentKind) -> bool {
    if name == "agy-gemini" {
        return false;
    }
    let Some(suffix) = name
        .strip_prefix(agent.as_str())
        .and_then(|rest| rest.strip_prefix('-'))
    else {
        return false;
    };
    is_profile_suffix(suffix)
}

/// `[A-Za-z0-9_.]{1,40}`: the part of a profile name after `claude-`.
pub(crate) fn is_profile_suffix(suffix: &str) -> bool {
    (1..=40).contains(&suffix.len())
        && suffix
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.')
}

/// Letters, digits, spaces and plain punctuation only, 1–120 characters. The wake prompt is user
/// text that ends up on a command line (through cmd.exe for npm `.cmd` shims), so anything a shell
/// could interpret is refused rather than escaped. The settings UI validates with the same rule.
pub fn is_safe_prompt(prompt: &str) -> bool {
    let count = prompt.chars().count();
    (1..=120).contains(&count)
        && prompt.chars().all(|c| {
            c.is_alphabetic() || c.is_numeric() || matches!(c, ' ' | '.' | ',' | '?' | '\'' | '-')
        })
        && !prompt.trim().is_empty()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentCommand {
    pub exe: PathBuf,
    pub env: Env,
}

/// How to run `agent` for a profile: its launcher when the terminal used one (the launcher then
/// sets the profile variable itself, so ours is removed), otherwise the agent's CLI with the
/// variable set for a non-default profile.
pub fn agent_command(
    agent: AgentKind,
    profile_dir: Option<&Path>,
    launcher: Option<&str>,
    deps: &dyn ProviderDeps,
) -> Option<AgentCommand> {
    let variable = agent.profile_variable();
    let default_dir = deps.home().join(agent.default_dir());
    if let Some(name) = launcher.filter(|name| is_launcher_name(name, agent)) {
        if let Some(exe) = deps.resolve_launcher(name) {
            return Some(AgentCommand {
                exe,
                env: profile_env(variable, None, &default_dir, deps.env()),
            });
        }
    }
    let exe = deps.resolve(agent)?;
    Some(AgentCommand {
        exe,
        env: profile_env(variable, profile_dir, &default_dir, deps.env()),
    })
}

#[cfg(test)]
#[path = "launcher_tests.rs"]
mod tests;
