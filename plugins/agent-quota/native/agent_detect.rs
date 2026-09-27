//! Which AI agent runs in a terminal, which account profile it uses, and which of its processes
//! must freeze when its quota runs out.
//!
//! Pure over explicit process rows so every rule is testable without real processes; the sysinfo
//! glue that produces the rows lives in `agent_snapshot.rs`.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

/// The agents the quota monitor understands. Anything else in a terminal is not its business.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentKind {
    Claude,
    Codex,
}

impl AgentKind {
    fn name(self) -> &'static str {
        match self {
            AgentKind::Claude => "claude",
            AgentKind::Codex => "codex",
        }
    }

    /// The variable that names the profile directory, and its default under the home directory.
    fn profile_variable(self) -> (&'static str, &'static str) {
        match self {
            AgentKind::Claude => ("CLAUDE_CONFIG_DIR", ".claude"),
            AgentKind::Codex => ("CODEX_HOME", ".codex"),
        }
    }
}

/// One process as the snapshot saw it. `env` holds only the profile variables in `PROFILE_ENV`,
/// and only for a main agent whose profile could not be learnt from its launcher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcRow {
    pub pid: u32,
    pub parent: u32,
    pub start_time: u64,
    pub image: String,
    pub cmd: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// The only environment variables ever read from an agent process: each names a profile directory.
pub const PROFILE_ENV: [&str; 2] = ["CLAUDE_CONFIG_DIR", "CODEX_HOME"];

/// The terminal's main agent: the agent process nearest the shell.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedAgent {
    pub agent: AgentKind,
    pub pid: u32,
    pub start_time: u64,
    pub profile_dir: Option<String>,
    pub profile_name: String,
    /// The profile launcher the user ran (`claude-th` for `claude-th.cmd`), when there was one.
    pub launcher: Option<String>,
    pub sub_agent_count: usize,
}

/// One process the suspend step targets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcTarget {
    pub pid: u32,
    pub start_time: u64,
    pub image: String,
    /// Threads this module suspended in the process (Windows); resumed exactly once each.
    pub threads: Vec<u32>,
}

fn image_stem(image: &str) -> String {
    let lower = image.to_ascii_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
}

fn cmd_mentions(row: &ProcRow, needles: &[&str]) -> bool {
    row.cmd.iter().any(|arg| {
        let lower = arg.to_ascii_lowercase().replace('\\', "/");
        needles.iter().any(|needle| lower.contains(needle))
    })
}

/// Script hosts that run an agent as a package. A plain `node build.js` is not an agent.
fn is_script_host(stem: &str) -> bool {
    matches!(stem, "node" | "bun" | "deno")
}

/// Classify one process. Scripts, shells, build tools and MCP servers return `None` and are never
/// frozen: suspending them would break the user's work without saving any quota.
pub fn classify(row: &ProcRow) -> Option<AgentKind> {
    let stem = image_stem(&row.image);
    if stem == "claude" {
        return Some(AgentKind::Claude);
    }
    if stem == "codex" || stem.starts_with("codex-") {
        return Some(AgentKind::Codex);
    }
    if is_script_host(&stem) {
        if cmd_mentions(row, &["@anthropic-ai/claude-code", "/claude-code/cli"]) {
            return Some(AgentKind::Claude);
        }
        if cmd_mentions(row, &["@openai/codex"]) {
            return Some(AgentKind::Codex);
        }
    }
    None
}

fn children_index(rows: &[ProcRow]) -> HashMap<u32, Vec<usize>> {
    let mut children: HashMap<u32, Vec<usize>> = HashMap::new();
    for (index, row) in rows.iter().enumerate() {
        if row.parent != row.pid {
            children.entry(row.parent).or_default().push(index);
        }
    }
    children
}

/// Indices of every transitive descendant of `root`, breadth-first. The visited set guards against
/// a PID-reuse cycle, as in `ProcTable::descendants`.
fn descendant_indices(rows: &[ProcRow], root: u32) -> Vec<usize> {
    let children = children_index(rows);
    let mut seen = HashSet::from([root]);
    let mut queue = std::collections::VecDeque::from([root]);
    let mut out = Vec::new();
    while let Some(pid) = queue.pop_front() {
        for &index in children.get(&pid).into_iter().flatten() {
            let child = rows[index].pid;
            if seen.insert(child) {
                out.push(index);
                queue.push_back(child);
            }
        }
    }
    out
}

fn env_value<'a>(row: &'a ProcRow, key: &str) -> Option<&'a str> {
    row.env
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .map(|(_, value)| value.as_str())
        .filter(|value| !value.trim().is_empty())
}

/// Resolve the profile directory an agent uses: its override variable, else the agent's default
/// directory under `home`.
pub fn profile_dir(kind: AgentKind, row: &ProcRow, home: Option<&str>) -> Option<String> {
    let (variable, default) = kind.profile_variable();
    env_value(row, variable)
        .map(|value| value.trim().to_string())
        .or_else(|| {
            home.map(|home| {
                PathBuf::from(home)
                    .join(default)
                    .to_string_lossy()
                    .into_owned()
            })
        })
}

/// A short, stable label for a profile: the directory name without its leading dot.
pub fn profile_name(kind: AgentKind, dir: Option<&str>) -> String {
    dir.and_then(|dir| {
        let trimmed = dir.trim_end_matches(['/', '\\']);
        trimmed.rsplit(['/', '\\']).next().map(str::to_string)
    })
    .map(|name| name.trim_start_matches('.').to_string())
    .filter(|name| !name.is_empty())
    .unwrap_or_else(|| kind.name().to_string())
}

/// `claude-th` from a command-line token naming `…\claude-th.cmd` (or `.bat`). Only names shaped
/// `<agent>-<suffix>` with a short plain suffix qualify: the sidecar resolves the name again from
/// the user's bin directory, so nothing here ever becomes a path to execute.
pub fn launcher_name(token: &str, kind: AgentKind) -> Option<String> {
    let file = token.trim_matches(['"', '\'']).rsplit(['/', '\\']).next()?;
    let lower = file.to_ascii_lowercase();
    let stem = lower
        .strip_suffix(".cmd")
        .or_else(|| lower.strip_suffix(".bat"))
        .or_else(|| lower.strip_suffix(".ps1"))
        .or_else(|| lower.strip_suffix(".sh"))
        .or_else(|| (!lower.contains('.')).then_some(lower.as_str()))?;
    let suffix = stem.strip_prefix(kind.name())?.strip_prefix('-')?;
    let plain = !suffix.is_empty()
        && suffix.len() <= 40
        && suffix
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.');
    plain.then(|| stem.to_string())
}

/// The launcher script in the command line of an ancestor between the shell and the agent — for
/// example `cmd.exe /c "C:\Users\me\.local\bin\claude-th.cmd"` — or the agent command itself.
fn find_launcher(
    rows: &[ProcRow],
    in_tree: &HashMap<u32, usize>,
    main: &ProcRow,
    kind: AgentKind,
) -> Option<String> {
    let in_main = main
        .cmd
        .iter()
        .flat_map(|arg| arg.split(|c: char| c.is_whitespace() || c == '"'))
        .find_map(|token| launcher_name(token, kind));
    if in_main.is_some() {
        return in_main;
    }

    let mut seen = HashSet::new();
    let mut parent = main.parent;
    while let Some(&index) = in_tree.get(&parent) {
        if !seen.insert(parent) {
            return None;
        }
        let found = rows[index]
            .cmd
            .iter()
            .flat_map(|arg| arg.split(|c: char| c.is_whitespace() || c == '"'))
            .find_map(|token| launcher_name(token, kind));
        if found.is_some() {
            return found;
        }
        parent = rows[index].parent;
    }
    None
}

/// The terminal's main agent under `shell_pid`: the agent process with no agent ancestor inside the
/// shell's tree. When several run side by side, the oldest wins so the choice is stable per tick.
pub fn detect_main_agent(
    rows: &[ProcRow],
    shell_pid: u32,
    home: Option<&str>,
) -> Option<DetectedAgent> {
    let tree = descendant_indices(rows, shell_pid);
    let in_tree: HashMap<u32, usize> = tree.iter().map(|&index| (rows[index].pid, index)).collect();
    let has_agent_ancestor = |index: usize| {
        let mut seen = HashSet::new();
        let mut parent = rows[index].parent;
        while let Some(&ancestor) = in_tree.get(&parent) {
            if !seen.insert(parent) {
                return false;
            }
            if classify(&rows[ancestor]).is_some() {
                return true;
            }
            parent = rows[ancestor].parent;
        }
        false
    };
    let main_index = tree
        .iter()
        .copied()
        .filter(|&index| classify(&rows[index]).is_some())
        .filter(|&index| !has_agent_ancestor(index))
        .min_by_key(|&index| (rows[index].start_time, rows[index].pid))?;
    let main = &rows[main_index];
    let kind = classify(main)?;
    let launcher = find_launcher(rows, &in_tree, main, kind);
    let dir = profile_dir(kind, main, home);
    let sub_agent_count = descendant_indices(rows, main.pid)
        .iter()
        .filter(|&&index| classify(&rows[index]).is_some())
        .count();
    Some(DetectedAgent {
        agent: kind,
        pid: main.pid,
        start_time: main.start_time,
        profile_name: launcher
            .clone()
            .unwrap_or_else(|| profile_name(kind, dir.as_deref())),
        profile_dir: dir,
        launcher,
        sub_agent_count,
    })
}

/// Script hosts whose command line decides whether they are an agent at all. Every other
/// process is classified by its image name alone, without reading its memory.
pub fn script_host_pids(rows: &[ProcRow]) -> Vec<u32> {
    rows.iter()
        .filter(|row| is_script_host(&image_stem(&row.image)))
        .map(|row| row.pid)
        .collect()
}

/// The `cmd.exe` ancestors of the main agent under `shell_pid`: the only processes whose command
/// line can name the profile launcher the user ran.
pub fn launcher_host_pids(rows: &[ProcRow], shell_pid: u32) -> Vec<u32> {
    let Some(main) = detect_main_agent(rows, shell_pid, None) else {
        return Vec::new();
    };
    let by_pid: HashMap<u32, &ProcRow> = rows.iter().map(|row| (row.pid, row)).collect();
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut parent = by_pid.get(&main.pid).map(|row| row.parent);
    while let Some(pid) = parent.filter(|&pid| pid != shell_pid && seen.insert(pid)) {
        let Some(row) = by_pid.get(&pid) else { break };
        let stem = image_stem(&row.image);
        if matches!(stem.as_str(), "cmd" | "powershell" | "pwsh" | "bash" | "zsh" | "sh" | "wsl") {
            out.push(pid);
        }
        parent = Some(row.parent);
    }
    out
}

/// The main agent under `shell_pid`: the one process whose environment is worth reading. Every
/// other process's environment is left unread.
///
/// A launcher (`claude-work.cmd`) names the profile, but not where it lives: the script sets
/// `CLAUDE_CONFIG_DIR` to a folder of its choosing, so the directory must still come from the
/// agent's own environment. Without it, session lookup fell back to `~/.claude` and never found a
/// launcher profile's session files.
pub fn needs_profile_env(rows: &[ProcRow], shell_pid: u32) -> Option<u32> {
    detect_main_agent(rows, shell_pid, None).map(|found| found.pid)
}

/// What to freeze for the main agent `(pid, start_time)`: the main process itself plus every
/// agent-classified descendant — sub-sessions and sub-agents. Plain scripts and tools the agent
/// started keep running and are allowed to finish.
pub fn suspend_targets(rows: &[ProcRow], pid: u32, start_time: u64) -> Vec<ProcTarget> {
    let Some(main) = rows
        .iter()
        .find(|row| row.pid == pid && row.start_time == start_time)
    else {
        return Vec::new();
    };
    let target = |row: &ProcRow| ProcTarget {
        pid: row.pid,
        start_time: row.start_time,
        image: row.image.clone(),
        threads: Vec::new(),
    };
    let mut out = vec![target(main)];
    out.extend(
        descendant_indices(rows, pid)
            .into_iter()
            .map(|index| &rows[index])
            .filter(|row| classify(row).is_some())
            .map(target),
    );
    out
}

#[cfg(test)]
#[path = "agent_detect_tests.rs"]
mod tests;
