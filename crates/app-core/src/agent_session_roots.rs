//! The agent profile directories whose conversations "Clean Up Sessions" indexes. Only folders that
//! exist are listed; nothing inside them is read here.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::{SessionAgent, SessionRoot};

pub(super) const PROFILE_SUFFIX_MAX: usize = 40;

fn is_profile_suffix(suffix: &str) -> bool {
    !suffix.is_empty()
        && suffix.len() <= PROFILE_SUFFIX_MAX
        && suffix
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
}

pub(super) fn is_real_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir())
}

pub(super) fn sorted_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| entry.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();
    names.sort_by_key(|name| name.to_ascii_lowercase());
    names
}

type FoundRoot = (SessionAgent, String, PathBuf);

/// Antigravity (agy and its IDE agent) keeps a `conversations` folder in `~/.gemini/antigravity`
/// and `~/.gemini/antigravity-<x>`.
fn agy_roots(home: &Path) -> Vec<FoundRoot> {
    let gemini = home.join(".gemini");
    let mut roots = Vec::new();
    for entry in sorted_names(&gemini) {
        let named = entry == "antigravity"
            || entry
                .strip_prefix("antigravity-")
                .is_some_and(is_profile_suffix);
        let dir = gemini.join(&entry);
        if named && is_real_dir(&dir) && is_real_dir(&dir.join("conversations")) {
            roots.push((SessionAgent::Agy, entry, dir));
        }
    }
    roots
}

/// Every profile directory under `home`, defaults first, then the named ones by name, then
/// Antigravity's. A profile name found twice (`~/.claude-work` and `~/claude-profiles/work`)
/// is numbered the second time.
pub fn session_roots(home: &Path) -> Vec<SessionRoot> {
    let mut roots = Vec::new();
    for (agent, name) in [
        (SessionAgent::Claude, "claude"),
        (SessionAgent::Codex, "codex"),
    ] {
        let dir = home.join(format!(".{name}"));
        if is_real_dir(&dir) {
            roots.push((agent, name.to_string(), dir));
        }
    }
    for entry in sorted_names(home) {
        for (agent, prefix) in [
            (SessionAgent::Claude, ".claude-"),
            (SessionAgent::Codex, ".codex-"),
        ] {
            let Some(suffix) = entry.strip_prefix(prefix) else {
                continue;
            };
            let dir = home.join(&entry);
            if is_profile_suffix(suffix) && is_real_dir(&dir) {
                roots.push((agent, format!("{}{suffix}", &prefix[1..]), dir));
            }
        }
    }
    let profiles_dir = home.join("claude-profiles");
    for entry in sorted_names(&profiles_dir) {
        let suffix = entry.strip_prefix("claude-").unwrap_or(&entry);
        let dir = profiles_dir.join(&entry);
        if is_profile_suffix(suffix) && is_real_dir(&dir) {
            roots.push((SessionAgent::Claude, format!("claude-{suffix}"), dir));
        }
    }
    roots.extend(agy_roots(home));
    let mut seen: HashMap<String, usize> = HashMap::new();
    roots
        .into_iter()
        .map(|(agent, profile, dir)| {
            let count = seen.entry(profile.to_ascii_lowercase()).or_insert(0);
            *count += 1;
            let profile = if *count == 1 {
                profile
            } else {
                format!("{profile} ({count})")
            };
            SessionRoot {
                agent,
                profile,
                dir,
            }
        })
        .collect()
}
