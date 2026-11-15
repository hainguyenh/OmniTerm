//! Every agent profile this user can start, for the Profiles dashboard.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use super::deps::{env_var, Platform, ProviderDeps};
use super::launcher::{is_launcher_name, is_profile_suffix};
use super::types::{AgentKind, DiscoveredProfile};

/// Claude only for now: codex profiles are not offered until their quota reading is supported.
const AGENTS: [AgentKind; 1] = [AgentKind::Claude];
/// Only launchers that can be run again by name (see `SystemDeps::resolve_launcher`) are listed.
const WINDOWS_LAUNCHER_EXTENSIONS: [&str; 3] = [".cmd", ".bat", ".exe"];
/// A PATH with hundreds of `claude-*` files is not a real setup; the dashboard stays readable.
const MAX_PROFILES: usize = 50;

/// `claude-work.CMD` → `claude-work` on Windows; unix launchers are extensionless scripts.
fn launcher_base(file: &str, platform: Platform) -> Option<String> {
    if platform == Platform::Unix {
        return Some(file.to_string());
    }
    let dot = file.rfind('.').filter(|at| *at > 0)?;
    let ext = file[dot..].to_ascii_lowercase();
    WINDOWS_LAUNCHER_EXTENSIONS
        .contains(&ext.as_str())
        .then(|| file[..dot].to_string())
}

/// Case-insensitive, then ordinal: the same order on every machine, whatever its locale.
fn by_name(left: &str, right: &str) -> std::cmp::Ordering {
    left.to_lowercase()
        .cmp(&right.to_lowercase())
        .then_with(|| left.cmp(right))
}

fn key(name: &str, platform: Platform) -> String {
    match platform {
        Platform::Windows => name.to_lowercase(),
        Platform::Unix => name.to_string(),
    }
}

fn search_dirs(deps: &dyn ProviderDeps, platform: Platform) -> Vec<PathBuf> {
    let path = env_var(deps.env(), "PATH")
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let from_path = path
        .split(platform.path_separator())
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from);
    let mut seen = HashSet::new();
    std::iter::once(deps.home().join(".local").join("bin"))
        .chain(from_path)
        .filter(|dir| seen.insert(key(&dir.to_string_lossy(), platform)))
        .collect()
}

fn exists(deps: &dyn ProviderDeps, dir: &Path) -> bool {
    matches!(deps.mtime(dir), Ok(Some(_)))
}

/// Record a profile directory found by its folder name, filling in a launcher's missing one.
fn add_directory(
    profiles: &mut BTreeMap<String, DiscoveredProfile>,
    platform: Platform,
    name: String,
    dir: PathBuf,
) {
    let entry = profiles
        .entry(key(&name, platform))
        .or_insert_with(|| DiscoveredProfile {
            agent: AgentKind::Claude,
            profile_name: name,
            profile_dir: None,
            launcher: None,
        });
    if entry.profile_dir.is_none() {
        entry.profile_dir = Some(dir);
    }
}

/// Each agent's default profile when its directory exists (`~/.claude`), then every profile
/// launcher (`claude-work`) found in `~/.local/bin` or on PATH — the same places
/// `resolve_launcher` looks, so each listed launcher can be probed by name — then the profile
/// directories `~/.claude-<name>` and `~/claude-profiles/<name>`. Names are matched with the
/// launcher rule, never executed here, and de-duplicated the way the OS resolves them
/// (case-insensitively on Windows). Unreadable entries are skipped, never fatal.
pub fn list_profiles(deps: &dyn ProviderDeps, platform: Platform) -> Vec<DiscoveredProfile> {
    let home = deps.home().to_path_buf();
    let defaults: Vec<DiscoveredProfile> = AGENTS
        .iter()
        .map(|agent| (*agent, home.join(agent.default_dir())))
        .filter(|(_, dir)| exists(deps, dir))
        .map(|(agent, dir)| DiscoveredProfile {
            agent,
            profile_name: agent.as_str().to_string(),
            profile_dir: Some(dir),
            launcher: None,
        })
        .collect();

    let mut profiles: BTreeMap<String, DiscoveredProfile> = BTreeMap::new();
    for dir in search_dirs(deps, platform) {
        for file in deps.list_dir(&dir).unwrap_or_default() {
            let Some(base) = launcher_base(&file, platform) else {
                continue;
            };
            let Some(agent) = AGENTS
                .iter()
                .copied()
                .find(|agent| is_launcher_name(&base, *agent))
            else {
                continue;
            };
            let id = key(&base, platform);
            profiles.entry(id).or_insert_with(|| DiscoveredProfile {
                agent,
                profile_name: base.clone(),
                profile_dir: None,
                launcher: Some(base),
            });
        }
    }

    for entry in deps.list_dir(&home).unwrap_or_default() {
        let Some(suffix) = entry
            .strip_prefix(".claude-")
            .filter(|suffix| is_profile_suffix(suffix))
        else {
            continue;
        };
        let dir = home.join(&entry);
        if exists(deps, &dir) {
            add_directory(&mut profiles, platform, format!("claude-{suffix}"), dir);
        }
    }

    let profiles_dir = home.join("claude-profiles");
    for sub in deps.list_dir(&profiles_dir).unwrap_or_default() {
        let suffix = sub.strip_prefix("claude-").unwrap_or(&sub);
        if !is_profile_suffix(suffix) {
            continue;
        }
        let dir = profiles_dir.join(&sub);
        if exists(deps, &dir) {
            add_directory(&mut profiles, platform, format!("claude-{suffix}"), dir);
        }
    }

    let mut sorted: Vec<DiscoveredProfile> = profiles.into_values().collect();
    sorted.sort_by(|left, right| by_name(&left.profile_name, &right.profile_name));
    defaults
        .into_iter()
        .chain(sorted)
        .take(MAX_PROFILES)
        .collect()
}

#[cfg(test)]
#[path = "profiles_tests.rs"]
mod tests;
