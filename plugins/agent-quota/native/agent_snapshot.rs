//! Live process rows for the agent classifier, read with as little intrusion as possible.
//!
//! On Windows, sysinfo reads a process's command line and environment out of its memory (the PEB),
//! which is exactly the kind of cross-process access security software watches for. So reading is
//! done in phases and only where it decides something:
//!
//!   1. names, parents and start times for each shell's tree — no memory is read;
//!   2. command lines for script hosts (`node`, `bun`, `deno`: is this one an agent?) and for the
//!      `cmd.exe` ancestors of a detected agent (which launcher started it?);
//!   3. the profile environment of the single main agent whose launcher is unknown.
//!
//! Every other process's memory is left alone.

use super::agent_detect::{ProcRow, PROFILE_ENV};
use crate::proc_activity::ProcTable;
use std::collections::HashMap;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

/// The environment keys kept from a process, matched case-insensitively (Windows spells them
/// however the launcher did). Everything else in the environment is dropped on the spot.
fn profile_env(environ: &[std::ffi::OsString]) -> Vec<(String, String)> {
    environ
        .iter()
        .filter_map(|entry| {
            let entry = entry.to_string_lossy();
            let (key, value) = entry.split_once('=')?;
            PROFILE_ENV
                .iter()
                .any(|wanted| wanted.eq_ignore_ascii_case(key))
                .then(|| (key.to_string(), value.to_string()))
        })
        .collect()
}

fn pids(values: &[u32]) -> Vec<Pid> {
    let mut out: Vec<Pid> = values.iter().copied().map(Pid::from_u32).collect();
    out.sort_unstable();
    out.dedup();
    out
}

/// Phase 1: rows for every shell in `shell_pids` and all of their descendants, names only.
pub fn tree_rows(system: &mut System, shell_pids: &[u32]) -> Vec<ProcRow> {
    if shell_pids.is_empty() {
        return Vec::new();
    }
    let table = ProcTable::snapshot(system);
    let mut wanted: Vec<u32> = Vec::new();
    for &shell in shell_pids {
        wanted.push(shell);
        wanted.extend(table.descendants(shell));
    }
    pids(&wanted)
        .iter()
        .filter_map(|pid| system.process(*pid))
        .map(|process| ProcRow {
            pid: process.pid().as_u32(),
            parent: process.parent().map(|parent| parent.as_u32()).unwrap_or(0),
            start_time: process.start_time(),
            image: process.name().to_string_lossy().into_owned(),
            cmd: Vec::new(),
            env: Vec::new(),
        })
        .collect()
}

/// Phase 2: fill in the command lines of `targets`, and only those.
pub fn fill_command_lines(system: &mut System, rows: &mut [ProcRow], targets: &[u32]) {
    if targets.is_empty() {
        return;
    }
    let wanted = pids(targets);
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&wanted),
        false,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::OnlyIfNotSet),
    );
    for row in rows.iter_mut().filter(|row| targets.contains(&row.pid)) {
        if let Some(process) = system.process(Pid::from_u32(row.pid)) {
            row.cmd = process
                .cmd()
                .iter()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect();
        }
    }
}

/// Phase 3: the profile variables of `targets` (at most one main agent per terminal).
pub fn fill_profile_env(system: &mut System, rows: &mut [ProcRow], targets: &[u32]) {
    if targets.is_empty() {
        return;
    }
    let wanted = pids(targets);
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&wanted),
        false,
        ProcessRefreshKind::nothing().with_environ(UpdateKind::OnlyIfNotSet),
    );
    for row in rows.iter_mut().filter(|row| targets.contains(&row.pid)) {
        if let Some(process) = system.process(Pid::from_u32(row.pid)) {
            row.env = profile_env(process.environ());
        }
    }
}

/// Current start time of each still-running pid in `pids`. A pid missing from the result has
/// exited; one with a different start time has been recycled by an unrelated process.
pub fn start_times(system: &mut System, targets: &[u32]) -> HashMap<u32, u64> {
    if targets.is_empty() {
        return HashMap::new();
    }
    let wanted = pids(targets);
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&wanted),
        true,
        ProcessRefreshKind::nothing(),
    );
    wanted
        .iter()
        .filter_map(|pid| system.process(*pid))
        .map(|process| (process.pid().as_u32(), process.start_time()))
        .collect()
}

/// The user's home directory, the base of each agent's default profile directory.
pub fn home_dir() -> Option<String> {
    ["USERPROFILE", "HOME"]
        .iter()
        .find_map(|key| std::env::var(key).ok().filter(|value| !value.is_empty()))
}

#[cfg(test)]
#[path = "agent_snapshot_tests.rs"]
mod tests;
