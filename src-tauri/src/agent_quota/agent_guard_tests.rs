use super::*;
use std::sync::Mutex;

/// Records every call; hands out thread ids so held/released bookkeeping can be checked exactly.
#[derive(Default)]
struct FakeOps {
    calls: Mutex<Vec<(&'static str, u32, Vec<u32>)>>,
    failing: Vec<u32>,
    /// Threads each pid "has"; suspend returns the ones not already held.
    threads: Vec<(u32, Vec<u32>)>,
}

impl FakeOps {
    fn record(&self, verb: &'static str, pid: u32, threads: &[u32]) -> Result<(), String> {
        self.calls
            .lock()
            .expect("calls lock")
            .push((verb, pid, threads.to_vec()));
        if self.failing.contains(&pid) {
            Err("denied".into())
        } else {
            Ok(())
        }
    }
    fn calls(&self) -> Vec<(&'static str, u32, Vec<u32>)> {
        self.calls.lock().expect("calls lock").clone()
    }
}

impl ProcOps for FakeOps {
    fn suspend(&self, pid: u32, held: &[u32]) -> Result<Vec<u32>, String> {
        self.record("suspend", pid, held)?;
        let all = self
            .threads
            .iter()
            .find(|(owner, _)| *owner == pid)
            .map(|(_, threads)| threads.clone())
            .unwrap_or_else(|| vec![pid * 10]);
        Ok(all.into_iter().filter(|tid| !held.contains(tid)).collect())
    }
    fn resume(&self, pid: u32, threads: &[u32]) -> Result<(), String> {
        self.record("resume", pid, threads)
    }
    fn terminate(&self, pid: u32) -> Result<(), String> {
        self.record("terminate", pid, &[])
    }
}

fn row(pid: u32, parent: u32, start_time: u64, image: &str) -> ProcRow {
    ProcRow {
        pid,
        parent,
        start_time,
        image: image.to_string(),
        cmd: Vec::new(),
        env: Vec::new(),
    }
}

fn tree() -> Vec<ProcRow> {
    vec![
        row(100, 1, 1, "pwsh.exe"),
        row(101, 100, 2, "claude.exe"),
        row(102, 101, 3, "python.exe"),
        row(103, 101, 4, "claude.exe"),
    ]
}

fn held(pid: u32, start_time: u64, threads: &[u32]) -> ProcTarget {
    ProcTarget {
        pid,
        start_time,
        image: "claude.exe".into(),
        threads: threads.to_vec(),
        profile_name: None,
    }
}

#[test]
fn detects_each_session_with_an_agent() {
    let rows = tree();
    let shells = vec![("a".to_string(), 100), ("b".to_string(), 999)];
    let found = detect_sessions(&rows, &shells, None);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].session_id, "a");
    let json = serde_json::to_value(&found[0]).expect("serialize");
    assert_eq!(json["sessionId"], "a");
    assert_eq!(json["pid"], 101);
}

#[test]
fn refuses_anything_but_the_current_main_agent() {
    let rows = tree();
    assert!(verify_main(&rows, 100, 101, 2).is_ok());
    assert!(verify_main(&rows, 100, 101, 99)
        .unwrap_err()
        .contains("changed"));
    assert!(
        verify_main(&rows, 100, 103, 4).is_err(),
        "a sub-agent is not the main agent"
    );
    assert!(verify_main(&rows, 555, 101, 2)
        .unwrap_err()
        .contains("No AI agent"));
}

#[test]
fn suspends_agents_once_and_catches_late_sub_agents_and_threads() {
    let ops = FakeOps {
        threads: vec![(101, vec![1, 2]), (103, vec![3])],
        ..FakeOps::default()
    };
    let mut holding = Vec::new();
    let mut rows = tree();
    let first = suspend_session(&ops, &rows, 100, 101, 2, &mut holding, None).expect("suspend");
    assert_eq!(first.newly_frozen, 2);
    assert_eq!(holding[0].threads, vec![1, 2]);
    assert_eq!(holding[1].threads, vec![3]);

    rows.push(row(104, 103, 5, "codex.exe"));
    let ops = FakeOps {
        threads: vec![(101, vec![1, 2, 9]), (103, vec![3])],
        ..FakeOps::default()
    };
    let second = suspend_session(&ops, &rows, 100, 101, 2, &mut holding, None).expect("re-scan");
    assert_eq!(second.newly_frozen, 1, "only the new sub-agent is new");
    assert_eq!(second.frozen.len(), 3);
    assert_eq!(
        holding[0].threads,
        vec![1, 2, 9],
        "a late thread joins the held set"
    );
    assert!(ops.calls().contains(&("suspend", 101, vec![1, 2])));
}

#[test]
fn a_failed_suspend_is_reported_and_retried_later() {
    let ops = FakeOps {
        failing: vec![103],
        ..FakeOps::default()
    };
    let mut holding = Vec::new();
    let report = suspend_session(&ops, &tree(), 100, 101, 2, &mut holding, None).expect("partial");
    assert_eq!(report.newly_frozen, 1);
    assert_eq!(report.errors.len(), 1);
    assert!(report.errors[0].contains("claude.exe (103)"));
    assert_eq!(holding.len(), 1, "the failed process is not held");
    // A failing re-scan of an already-held process keeps what is held.
    let ops = FakeOps {
        failing: vec![101, 103],
        ..FakeOps::default()
    };
    let again = suspend_session(&ops, &tree(), 100, 101, 2, &mut holding, None).expect("re-scan");
    assert_eq!(again.frozen.len(), 1);
    assert_eq!(holding[0].threads, vec![1010]);
}

#[test]
fn suspend_rejects_a_stale_request_without_touching_processes() {
    let ops = FakeOps::default();
    let mut holding = Vec::new();
    assert!(suspend_session(&ops, &tree(), 100, 101, 7, &mut holding, None).is_err());
    assert!(ops.calls().is_empty());
}

#[test]
fn resume_only_thaws_processes_that_are_still_the_same() {
    let ops = FakeOps {
        failing: vec![104],
        ..FakeOps::default()
    };
    let holding = vec![
        held(101, 2, &[1, 2]),
        held(103, 4, &[3]),
        held(104, 5, &[4]),
        held(105, 6, &[5]),
    ];
    let live = HashMap::from([(101, 2), (103, 40), (104, 5)]);
    assert_eq!(resume_held(&ops, holding, &live), 1);
    assert_eq!(
        ops.calls(),
        vec![("resume", 101, vec![1, 2]), ("resume", 104, vec![4])]
    );
}

#[test]
fn terminate_thaws_held_processes_and_stops_deepest_first() {
    let ops = FakeOps::default();
    let stopped =
        terminate_session(&ops, &tree(), 100, 101, 2, vec![held(103, 4, &[7])], None).expect("terminate");
    assert_eq!(stopped, 2);
    assert_eq!(
        ops.calls(),
        vec![
            ("resume", 103, vec![7]),
            ("terminate", 103, vec![]),
            ("terminate", 101, vec![])
        ]
    );
    assert!(terminate_session(&ops, &tree(), 100, 1, 1, Vec::new(), None).is_err());
}

#[test]
fn terminate_counts_only_processes_that_stopped() {
    let ops = FakeOps {
        failing: vec![101],
        ..FakeOps::default()
    };
    assert_eq!(
        terminate_session(&ops, &tree(), 100, 101, 2, Vec::new(), None),
        Ok(1)
    );
}

fn with_env(mut r: ProcRow, key: &str, value: &str) -> ProcRow {
    r.env.push((key.to_string(), value.to_string()));
    r
}

#[test]
fn suspends_all_processes_sharing_the_same_profile_across_the_system() {
    let ops = FakeOps::default();
    let mut holding = Vec::new();
    let rows = vec![
        row(100, 1, 1, "pwsh.exe"),
        with_env(
            row(101, 100, 2, "claude.exe"),
            "CLAUDE_CONFIG_DIR",
            "C:\\profiles\\work",
        ),
        // Out-of-tree Claude process sharing the same profile directory
        with_env(
            row(200, 1, 10, "claude.exe"),
            "CLAUDE_CONFIG_DIR",
            "C:\\profiles\\work",
        ),
        // Child of the out-of-tree Claude process
        row(201, 200, 11, "claude.exe"),
        // Out-of-tree Claude process using a DIFFERENT profile
        with_env(
            row(300, 1, 20, "claude.exe"),
            "CLAUDE_CONFIG_DIR",
            "C:\\profiles\\personal",
        ),
    ];
    let report = suspend_session(&ops, &rows, 100, 101, 2, &mut holding, None).expect("suspend");
    assert_eq!(report.newly_frozen, 3);
    let frozen_pids: Vec<u32> = report.frozen.iter().map(|t| t.pid).collect();
    assert!(frozen_pids.contains(&101));
    assert!(frozen_pids.contains(&200));
    assert!(frozen_pids.contains(&201));
    assert!(!frozen_pids.contains(&300), "different profile must not be suspended");
}

#[test]
fn native_ops_report_a_missing_process() {
    // No live process has this pid; nothing real is suspended or stopped.
    let missing = u32::MAX - 7;
    assert!(NativeOps.suspend(missing, &[]).is_err());
    assert!(NativeOps.terminate(missing).is_err());
    let _ = NativeOps.resume(missing, &[]);
}
