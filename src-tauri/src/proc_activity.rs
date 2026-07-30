//! Is a shell running anything? — a process-tree probe, used to tell an idle pane from a working one.
//!
//! A pane's tab shows "idle" or "running", and the only signal available from outside the shell is
//! whether its process has any live descendant: `ssh`, `vim`, a build tool, a batch file that shelled
//! out. This module answers exactly that, and knows nothing about sessions, channels or Tauri.
//!
//! Limits, all deliberate — the fail-safe direction is always *idle*, never a false "running":
//!
//!   * **WSL panes read idle.** `wsl.exe` proxies into the VM; the bash/build processes live under the
//!     distro's init inside it and never appear in the host process table. Seeing them would need a
//!     probe inside the distro. (See the WSL branch of launch.rs for how such a pane is spawned.)
//!   * **In-process work reads idle.** `powershell -Command "Start-Sleep 60"` forks nothing. This is
//!     why a command-launched pane is held busy for a short grace instead of trusting the probe alone
//!     (see session_activity.rs).
//!   * **PID reuse.** The shell's own pid is safe for the session's lifetime — portable-pty keeps the
//!     child's handle open, and Windows will not recycle a pid while a handle to it exists. Deeper in
//!     the tree a process whose real parent has exited carries a stale parent id, and if that number
//!     has been reused by our shell it looks like ours. `start_time` catches the common case (the
//!     impostor predates its claimed parent); a same-instant collision is not detectable this way.
//!   * **ConPTY's conhost.** `conhost.exe` / `OpenConsole.exe` are spawned by *us* alongside the
//!     shell, so they are the shell's siblings and should never show up as descendants. They are
//!     filtered anyway (by exact image name), because that parentage is an undocumented Windows
//!     detail — and tests/activity_integration.rs asserts an idle shell has no descendants, so a
//!     future Windows that reparents them fails loudly instead of pinning every pane to "running".

use std::collections::{HashMap, HashSet};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

/// One process as the platform reported it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ProcInfo {
    parent: u32,
    start_time: u64,
}

/// A whole-machine process tree, taken once and queried for every session (one enumeration per tick
/// instead of one per pane).
#[derive(Debug, Default)]
pub struct ProcTable {
    children: HashMap<u32, Vec<u32>>,
    procs: HashMap<u32, ProcInfo>,
}

/// Plumbing rather than user work: dropped while indexing so it can never read as "running".
fn is_infrastructure(image: &str) -> bool {
    let lower = image.to_ascii_lowercase();
    lower == "conhost.exe" || lower == "openconsole.exe"
}

impl ProcTable {
    /// Refresh `sys` in place and index it. The caller owns the `System` so its buffers are reused
    /// across ticks. `ProcessRefreshKind::nothing()` still yields pid/parent/name/start_time — the
    /// four fields used here — without opening a handle per process for cmdline, memory and disk.
    pub fn snapshot(sys: &mut System) -> Self {
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing(),
        );
        Self::from_rows(sys.processes().iter().map(|(pid, proc)| {
            (
                pid.as_u32(),
                proc.parent().map(|p| p.as_u32()).unwrap_or(0),
                proc.start_time(),
                proc.name().to_string_lossy().to_string(),
            )
        }))
    }

    /// One-shot snapshot for callers with no long-lived `System` (integration tests, one-off checks).
    /// Allocates a `System` per call — not for the poller.
    pub fn snapshot_now() -> Self {
        let mut sys = System::new();
        Self::snapshot(&mut sys)
    }

    /// Build a table from explicit `(pid, parent, start_time, image)` rows. The platform layer above
    /// is the only other producer, so every traversal rule below is testable with no real processes.
    pub fn from_rows<S: AsRef<str>>(rows: impl IntoIterator<Item = (u32, u32, u64, S)>) -> Self {
        let mut table = Self::default();
        for (pid, parent, start_time, image) in rows {
            if is_infrastructure(image.as_ref()) {
                continue;
            }
            table.procs.insert(pid, ProcInfo { parent, start_time });
        }
        // Index children only after every row is known, so the start-time check can see both ends.
        let pids: Vec<u32> = table.procs.keys().copied().collect();
        for pid in pids {
            let info = table.procs[&pid];
            // A root (parent 0) or a self-loop is nobody's child. Both occur in the wild: pid 0 is
            // the idle process, and a recycled pid can end up naming itself.
            if info.parent == 0 || info.parent == pid {
                continue;
            }
            if let Some(parent) = table.procs.get(&info.parent) {
                // Cannot be this parent's child: it existed first, so the parent id was recycled.
                if info.start_time < parent.start_time {
                    continue;
                }
            }
            table.children.entry(info.parent).or_default().push(pid);
        }
        table
    }

    /// True if `root` has at least one live descendant. This is the busy signal.
    pub fn has_descendant(&self, root: u32) -> bool {
        self.children.get(&root).is_some_and(|kids| !kids.is_empty())
    }

    /// Every transitive descendant of `root`, breadth-first.
    ///
    /// The visited set is not an optimization: a PID-reuse-corrupted parent map can describe a cycle
    /// (A's parent is B, B's parent is A), and an unguarded walk would spin forever inside the poller.
    pub fn descendants(&self, root: u32) -> Vec<u32> {
        let mut seen = HashSet::from([root]);
        let mut queue = vec![root];
        let mut out = Vec::new();
        while let Some(pid) = queue.pop() {
            for &child in self.children.get(&pid).into_iter().flatten() {
                if seen.insert(child) {
                    out.push(child);
                    queue.push(child);
                }
            }
        }
        out
    }

    pub fn process_count(&self) -> usize {
        self.procs.len()
    }
}

#[cfg(test)]
#[path = "proc_activity_tests.rs"]
mod tests;
