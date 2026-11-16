//! The quota guard's bookkeeping: which sessions run which agent, what a suspend request may touch,
//! and which frozen processes a resume must thaw.
//!
//! The renderer names processes, but it is never trusted to: a request only acts on a process that
//! detection just found as that session's main agent (or one of that agent's sub-agents), and every
//! resume re-checks the process start time, so a recycled pid is never signalled.

use super::agent_detect::{detect_main_agent, DetectedAgent, ProcRow, ProcTarget};
use serde::Serialize;
use std::collections::HashMap;

/// A terminal session and the main agent running in it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAgent {
    pub session_id: String,
    #[serde(flatten)]
    pub agent: DetectedAgent,
}

/// Outcome of one suspend request. `frozen` is everything currently held for the session, which the
/// watchdog compares tick to tick; `newly_frozen` counts late sub-agents this request caught.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuspendReport {
    pub frozen: Vec<ProcTarget>,
    pub newly_frozen: usize,
    pub errors: Vec<String>,
}

/// Process operations, injectable so the guard's rules run in tests without freezing anything.
/// `suspend` returns the threads it newly held (skipping `held`); `resume` releases exactly those.
pub trait ProcOps: Send + Sync {
    fn suspend(&self, pid: u32, held: &[u32]) -> Result<Vec<u32>, String>;
    fn resume(&self, pid: u32, threads: &[u32]) -> Result<(), String>;
    fn terminate(&self, pid: u32) -> Result<(), String>;
}

/// The real operations.
pub struct NativeOps;

impl ProcOps for NativeOps {
    fn suspend(&self, pid: u32, held: &[u32]) -> Result<Vec<u32>, String> {
        super::process_suspend::suspend(pid, held)
    }
    fn resume(&self, pid: u32, threads: &[u32]) -> Result<(), String> {
        super::process_suspend::resume(pid, threads)
    }
    fn terminate(&self, pid: u32) -> Result<(), String> {
        super::process_suspend::terminate(pid)
    }
}

/// Main agents for every `(session id, shell pid)`; sessions without an agent are omitted.
pub fn detect_sessions(
    rows: &[ProcRow],
    shells: &[(String, u32)],
    home: Option<&str>,
) -> Vec<SessionAgent> {
    shells
        .iter()
        .filter_map(|(session_id, shell)| {
            detect_main_agent(rows, *shell, home).map(|agent| SessionAgent {
                session_id: session_id.clone(),
                agent,
            })
        })
        .collect()
}

/// Refuse a request for anything but the session's current main agent.
pub fn verify_main(rows: &[ProcRow], shell: u32, pid: u32, start_time: u64) -> Result<(), String> {
    match detect_main_agent(rows, shell, None) {
        Some(found) if found.pid == pid && found.start_time == start_time => Ok(()),
        Some(_) => {
            Err("The terminal's agent changed; the request was for an older process.".into())
        }
        None => Err("No AI agent is running in that terminal.".into()),
    }
}

fn same(a: &ProcTarget, b: &ProcTarget) -> bool {
    a.pid == b.pid && a.start_time == b.start_time
}

fn norm_path(p: &str) -> String {
    p.trim()
        .trim_end_matches(['/', '\\'])
        .replace('/', "\\")
        .to_ascii_lowercase()
}

/// All processes to freeze for the main agent `(pid, start_time)` under `shell`:
/// the main process, all its agent descendants, and any other process on the system
/// running under the same profile (including detached sub-agents and sibling panes).
pub fn suspend_targets_for_profile(
    rows: &[ProcRow],
    shell: u32,
    pid: u32,
    start_time: u64,
    home: Option<&str>,
) -> Vec<ProcTarget> {
    let Some(main) = rows.iter().find(|r| r.pid == pid && r.start_time == start_time) else {
        return Vec::new();
    };
    let Some(kind) = super::agent_detect::classify(main) else {
        return Vec::new();
    };

    let detected = detect_main_agent(rows, shell, home);
    let target_profile_dir = detected
        .as_ref()
        .and_then(|d| d.profile_dir.clone())
        .or_else(|| super::agent_detect::profile_dir(kind, main, home));
    let target_profile_name = detected
        .as_ref()
        .map(|d| d.profile_name.clone())
        .unwrap_or_else(|| super::agent_detect::profile_name(kind, target_profile_dir.as_deref()));

    let mut out: Vec<ProcTarget> = Vec::new();
    let mut seen_pids = std::collections::HashSet::new();

    let mut add_target = |r: &ProcRow| {
        if seen_pids.insert(r.pid) {
            out.push(ProcTarget {
                pid: r.pid,
                start_time: r.start_time,
                image: r.image.clone(),
                threads: Vec::new(),
                profile_name: Some(target_profile_name.clone()),
            });
        }
    };

    // 1. The main process
    add_target(main);

    // 2. Descendants of main
    let main_descendants = super::agent_detect::descendant_indices(rows, pid);
    for &idx in &main_descendants {
        let r = &rows[idx];
        if super::agent_detect::classify(r).is_some() {
            add_target(r);
        }
    }

    // 3. All matching agent processes on the system using the same profile
    let mut matching_procs = Vec::new();
    for r in rows {
        if r.pid == pid {
            continue;
        }
        if let Some(r_kind) = super::agent_detect::classify(r) {
            if r_kind == kind {
                let r_dir = super::agent_detect::profile_dir(r_kind, r, home);
                let dir_match = match (&target_profile_dir, &r_dir) {
                    (Some(t), Some(rd)) => norm_path(t) == norm_path(rd),
                    (None, None) => true,
                    _ => false,
                };
                let r_name = super::agent_detect::profile_name(r_kind, r_dir.as_deref());
                let name_match = r_name.eq_ignore_ascii_case(&target_profile_name);
                if dir_match || name_match {
                    matching_procs.push(r.pid);
                    add_target(r);
                }
            }
        }
    }

    // 4. Descendants of any matching process (e.g. sub-agents of detached processes)
    for match_pid in matching_procs {
        for idx in super::agent_detect::descendant_indices(rows, match_pid) {
            let r = &rows[idx];
            if super::agent_detect::classify(r).is_some() {
                add_target(r);
            }
        }
    }

    out
}

/// Freeze the main agent's tree and profile-wide processes. Each call re-scans, so the watchdog
/// catches a sub-agent — or a new thread in an already-held process — that appeared after the first
/// freeze; nothing already held is suspended twice.
pub fn suspend_session(
    ops: &dyn ProcOps,
    rows: &[ProcRow],
    shell: u32,
    pid: u32,
    start_time: u64,
    held: &mut Vec<ProcTarget>,
    home: Option<&str>,
) -> Result<SuspendReport, String> {
    verify_main(rows, shell, pid, start_time)?;
    let mut report = SuspendReport::default();
    for mut target in suspend_targets_for_profile(rows, shell, pid, start_time, home) {
        if let Some(existing) = held.iter_mut().find(|existing| same(existing, &target)) {
            if let Ok(threads) = ops.suspend(existing.pid, &existing.threads) {
                existing.threads.extend(threads);
            }
            continue;
        }
        match ops.suspend(target.pid, &[]) {
            Ok(threads) => {
                report.newly_frozen += 1;
                target.threads = threads;
                held.push(target);
            }
            Err(error) => report
                .errors
                .push(format!("{} ({}): {error}", target.image, target.pid)),
        }
    }
    report.frozen = held.clone();
    Ok(report)
}

/// Thaw every held process that is still the same process (`live` maps pid → current start time).
/// Returns how many were resumed; entries whose process is gone are simply dropped.
pub fn resume_held(ops: &dyn ProcOps, held: Vec<ProcTarget>, live: &HashMap<u32, u64>) -> usize {
    held.into_iter()
        .filter(|target| live.get(&target.pid) == Some(&target.start_time))
        .filter(|target| ops.resume(target.pid, &target.threads).is_ok())
        .count()
}

/// Stop the main agent's AI processes. A frozen process is thawed first so it can exit, and the
/// whole tree is stopped deepest-first so the main agent cannot respawn a sub-agent.
pub fn terminate_session(
    ops: &dyn ProcOps,
    rows: &[ProcRow],
    shell: u32,
    pid: u32,
    start_time: u64,
    held: Vec<ProcTarget>,
    home: Option<&str>,
) -> Result<usize, String> {
    verify_main(rows, shell, pid, start_time)?;
    let mut targets = suspend_targets_for_profile(rows, shell, pid, start_time, home);
    targets.reverse();
    let mut stopped = 0;
    for target in targets {
        if let Some(existing) = held.iter().find(|existing| same(existing, &target)) {
            let _ = ops.resume(target.pid, &existing.threads);
        }
        if ops.terminate(target.pid).is_ok() {
            stopped += 1;
        }
    }
    Ok(stopped)
}

#[cfg(test)]
#[path = "agent_guard_tests.rs"]
mod tests;
