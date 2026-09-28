//! The quota guard's bookkeeping: which sessions run which agent, what a suspend request may touch,
//! and which frozen processes a resume must thaw.
//!
//! The renderer names processes, but it is never trusted to: a request only acts on a process that
//! detection just found as that session's main agent (or one of that agent's sub-agents), and every
//! resume re-checks the process start time, so a recycled pid is never signalled.

use super::agent_detect::{detect_main_agent, suspend_targets, DetectedAgent, ProcRow, ProcTarget};
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

/// Freeze the main agent's tree. Each call re-scans, so the watchdog catches a sub-agent — or a new
/// thread in an already-held process — that appeared after the first freeze; nothing already held
/// is suspended twice.
pub fn suspend_session(
    ops: &dyn ProcOps,
    rows: &[ProcRow],
    shell: u32,
    pid: u32,
    start_time: u64,
    held: &mut Vec<ProcTarget>,
) -> Result<SuspendReport, String> {
    verify_main(rows, shell, pid, start_time)?;
    let mut report = SuspendReport::default();
    for mut target in suspend_targets(rows, pid, start_time) {
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
) -> Result<usize, String> {
    verify_main(rows, shell, pid, start_time)?;
    let mut targets = suspend_targets(rows, pid, start_time);
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
