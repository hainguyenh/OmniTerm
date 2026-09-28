//! Commands against the mock runtime with a fixed process table and recording process operations:
//! nothing here spawns, copies, freezes or stops a real process.

use super::*;
use crate::pty::{PtyManager, PtySessionMeta};
use crate::test_support;
use session_protocol::{PersistencePolicy, SessionLifecycle};
use std::sync::{Arc, MutexGuard};
use tauri::test::MockRuntime;

const SHELL: u32 = 100;

fn row(pid: u32, parent: u32, start_time: u64, image: &str, cmd: &[&str]) -> ProcRow {
    ProcRow {
        pid,
        parent,
        start_time,
        image: image.to_string(),
        cmd: cmd.iter().map(|arg| arg.to_string()).collect(),
        env: Vec::new(),
    }
}

fn table() -> Vec<ProcRow> {
    vec![
        row(SHELL, 1, 1, "pwsh.exe", &[]),
        row(
            101,
            SHELL,
            2,
            "cmd.exe",
            &["cmd", "/c", "C:\\bin\\claude-th.cmd"],
        ),
        row(102, 101, 3, "claude.exe", &[]),
        row(103, 102, 4, "claude.exe", &["claude", "-p", "sub"]),
    ]
}

struct FakeSource {
    rows: Vec<ProcRow>,
}

impl ProcSource for FakeSource {
    fn detection_rows(&self, _shells: &[u32]) -> Vec<ProcRow> {
        self.rows.clone()
    }
    fn action_rows(&self, _shell: u32) -> Vec<ProcRow> {
        self.rows.clone()
    }
    fn start_times(&self, pids: &[u32]) -> HashMap<u32, u64> {
        self.rows
            .iter()
            .filter(|row| pids.contains(&row.pid))
            .map(|row| (row.pid, row.start_time))
            .collect()
    }
}

type Calls = Arc<Mutex<Vec<(&'static str, u32)>>>;

struct RecordingOps {
    calls: Calls,
}

impl ProcOps for RecordingOps {
    fn suspend(&self, pid: u32, held: &[u32]) -> Result<Vec<u32>, String> {
        self.calls.lock().expect("calls").push(("suspend", pid));
        Ok(if held.is_empty() {
            vec![pid * 10]
        } else {
            Vec::new()
        })
    }
    fn resume(&self, pid: u32, _threads: &[u32]) -> Result<(), String> {
        self.calls.lock().expect("calls").push(("resume", pid));
        Ok(())
    }
    fn terminate(&self, pid: u32) -> Result<(), String> {
        self.calls.lock().expect("calls").push(("terminate", pid));
        Ok(())
    }
}

fn meta(pid: Option<u32>, ssh: bool) -> PtySessionMeta {
    PtySessionMeta {
        pid,
        launched_with_command: false,
        ssh,
        busy: true,
        generation: 1,
        policy: PersistencePolicy::CloseWithApp,
        lifecycle: SessionLifecycle::Live,
        label: "Agent Quota test".to_string(),
    }
}

struct Fixture {
    _guard: MutexGuard<'static, ()>,
    app: tauri::App<MockRuntime>,
    calls: Calls,
}

impl Fixture {
    fn new(rows: Vec<ProcRow>) -> Self {
        let guard = test_support::lock();
        let app = test_support::mock_app();
        let calls: Calls = Arc::default();
        assert!(app.manage(PtyManager::new()));
        assert!(app.manage(AgentQuotaState {
            source: Box::new(FakeSource { rows }),
            ops: Box::new(RecordingOps {
                calls: calls.clone()
            }),
            held: Mutex::new(HashMap::new()),
        }));
        Self {
            _guard: guard,
            app,
            calls,
        }
    }

    fn handle(&self) -> AppHandle<MockRuntime> {
        self.app.handle().clone()
    }

    fn add_session(&self, id: &str, pid: Option<u32>, ssh: bool) {
        self.app
            .state::<PtyManager>()
            .sessions
            .insert(id.to_string(), meta(pid, ssh));
    }

    fn calls(&self) -> Vec<(&'static str, u32)> {
        self.calls.lock().expect("calls").clone()
    }
}

fn run<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

#[test]
fn detect_reports_the_launcher_and_skips_ssh_and_pid_less_sessions() {
    let fixture = Fixture::new(table());
    fixture.add_session("ssh", Some(SHELL), true);
    fixture.add_session("starting", None, false);
    assert!(run(agent_quota_detect(fixture.handle()))
        .expect("detect")
        .is_empty());
    fixture.add_session("local", Some(SHELL), false);
    let found = run(agent_quota_detect(fixture.handle())).expect("detect");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].session_id, "local");
    assert_eq!(found[0].agent.launcher.as_deref(), Some("claude-th"));
    assert_eq!(found[0].agent.pid, 102);
}

#[test]
fn commands_reject_unknown_sessions() {
    let fixture = Fixture::new(table());
    let error = run(agent_quota_suspend(fixture.handle(), "nope".into(), 1, 1)).unwrap_err();
    assert!(error.contains("not a running local session"));
    assert!(run(agent_quota_terminate(fixture.handle(), "nope".into(), 1, 1)).is_err());
    assert_eq!(
        run(agent_quota_resume(fixture.handle(), "nope".into())),
        Ok(0)
    );
    assert_eq!(run(agent_quota_resume_all(fixture.handle())), Ok(0));
    assert!(fixture.calls().is_empty());
}

#[test]
fn suspend_resume_and_terminate_act_only_on_the_verified_agent_tree() {
    let fixture = Fixture::new(table());
    fixture.add_session("local", Some(SHELL), false);
    assert!(
        run(agent_quota_suspend(
            fixture.handle(),
            "local".into(),
            102,
            99
        ))
        .is_err(),
        "a stale start time is refused"
    );
    assert!(fixture.calls().is_empty());

    let report = run(agent_quota_suspend(
        fixture.handle(),
        "local".into(),
        102,
        3,
    ))
    .expect("suspend");
    assert_eq!(report.newly_frozen, 2);
    assert_eq!(report.frozen[0].threads, vec![1020]);
    let again = run(agent_quota_suspend(
        fixture.handle(),
        "local".into(),
        102,
        3,
    ))
    .expect("re-scan");
    assert_eq!(again.newly_frozen, 0);

    assert_eq!(
        run(agent_quota_resume(fixture.handle(), "local".into())),
        Ok(2)
    );
    let _ = run(agent_quota_suspend(
        fixture.handle(),
        "local".into(),
        102,
        3,
    ))
    .expect("hold");
    assert_eq!(fixture.app.state::<AgentQuotaState>().resume_all(), 2);
    assert_eq!(run(agent_quota_resume_all(fixture.handle())), Ok(0));

    let _ = run(agent_quota_suspend(
        fixture.handle(),
        "local".into(),
        102,
        3,
    ))
    .expect("hold");
    assert_eq!(
        run(agent_quota_terminate(
            fixture.handle(),
            "local".into(),
            102,
            3
        )),
        Ok(2)
    );
    let calls = fixture.calls();
    assert!(
        calls.iter().all(|(_, pid)| *pid == 102 || *pid == 103),
        "{calls:?}"
    );
    assert_eq!(calls.last(), Some(&("terminate", 102)));
}

#[test]
fn the_live_source_reads_this_process_without_touching_others() {
    let _guard = test_support::lock();
    let source = LiveSource::default();
    let own = std::process::id();
    assert!(source
        .detection_rows(&[own])
        .iter()
        .any(|row| row.pid == own));
    assert!(source.action_rows(own).iter().any(|row| row.pid == own));
    assert!(source.start_times(&[own]).contains_key(&own));
    assert!(AgentQuotaState::default().detect(&[]).is_empty());
}

#[test]
fn blocking_work_needs_the_managed_state() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let error = run(agent_quota_resume_all(app.handle().clone())).unwrap_err();
    assert!(error.contains("not initialised"));
    assert!(
        local_shells(app.handle()).is_empty(),
        "no PtyManager means no sessions"
    );
}
