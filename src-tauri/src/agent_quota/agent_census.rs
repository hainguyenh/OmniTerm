//! How many Claude Code sessions run on this machine for each profile, in any terminal or app — not
//! only the panes OmniTerm watches.
//!
//! A pane that sits idle says nothing about its profile's quota when another session of the same
//! profile is working elsewhere: every session spends from one account. The renderer reads the
//! profile's quota more closely while more than one session, or a headless `claude -p`, runs on it
//! (`profileCensus.ts`), and not at all while its only session is idle. Walking the whole process
//! table is not free, so the renderer asks only when a Claude agent starts in a pane, never on a
//! timer.
//!
//! Pure over explicit process rows, like `agent_detect.rs`; `agent_snapshot::census_rows` reads them.

use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};

use super::agent_detect::{classify, profile_dir, AgentKind, ProcRow};

/// The Claude sessions of one profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCensus {
    pub agent: AgentKind,
    /// The profile directory the sessions use: their `CLAUDE_CONFIG_DIR`, else the default one.
    /// `None` gathers the sessions whose environment could not be read: their profile is unknown,
    /// and guessing the default one would count them against the wrong profile.
    pub profile_dir: Option<String>,
    /// Main Claude processes (sub-agents are part of their session), OmniTerm's own usage reads
    /// left out.
    pub sessions: usize,
    /// Of those, the ones started with `-p`/`--print`: they render no status line, so the status
    /// line bridge never sees what they spend.
    pub headless: usize,
}

fn has_arg(row: &ProcRow, wanted: &[&str]) -> bool {
    row.cmd
        .iter()
        .skip(1)
        .any(|arg| wanted.iter().any(|flag| arg.eq_ignore_ascii_case(flag)))
}

fn is_headless(row: &ProcRow) -> bool {
    has_arg(row, &["-p", "--print"])
}

/// `claude -p /usage`: a quota read (OmniTerm's own, or the user's), which spends nothing.
fn is_usage_read(row: &ProcRow) -> bool {
    is_headless(row) && has_arg(row, &["/usage", "//usage"])
}

/// Indices of the main Claude processes: Claude processes with no Claude ancestor.
pub fn claude_mains(rows: &[ProcRow]) -> Vec<usize> {
    let by_pid: HashMap<u32, usize> = rows
        .iter()
        .enumerate()
        .map(|(index, row)| (row.pid, index))
        .collect();
    let is_claude = |index: usize| classify(&rows[index]) == Some(AgentKind::Claude);
    let has_claude_ancestor = |index: usize| {
        let mut seen = HashSet::from([rows[index].pid]);
        let mut parent = rows[index].parent;
        while let Some(&ancestor) = by_pid.get(&parent) {
            if !seen.insert(parent) {
                return false;
            }
            if is_claude(ancestor) {
                return true;
            }
            parent = rows[ancestor].parent;
        }
        false
    };
    (0..rows.len())
        .filter(|&index| is_claude(index) && !has_claude_ancestor(index))
        .collect()
}

/// Same folder, however it is spelled: case, slashes and a trailing separator do not matter.
fn dir_key(dir: &str) -> String {
    dir.trim()
        .to_ascii_lowercase()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_string()
}

/// The Claude sessions per profile. `unreadable` holds the main processes whose environment could
/// not be read.
pub fn claude_census(
    rows: &[ProcRow],
    unreadable: &HashSet<u32>,
    home: Option<&str>,
) -> Vec<ProfileCensus> {
    let mut profiles: BTreeMap<Option<String>, ProfileCensus> = BTreeMap::new();
    for index in claude_mains(rows) {
        let row = &rows[index];
        if is_usage_read(row) {
            continue;
        }
        let dir = if unreadable.contains(&row.pid) {
            None
        } else {
            profile_dir(AgentKind::Claude, row, home)
        };
        let entry = profiles
            .entry(dir.as_deref().map(dir_key))
            .or_insert_with(|| ProfileCensus {
                agent: AgentKind::Claude,
                profile_dir: dir,
                sessions: 0,
                headless: 0,
            });
        entry.sessions += 1;
        if is_headless(row) {
            entry.headless += 1;
        }
    }
    profiles.into_values().collect()
}

#[cfg(test)]
#[path = "agent_census_tests.rs"]
mod tests;
