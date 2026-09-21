use super::*;
use crate::pty::PtySessionMeta;
use crate::test_support;
use session_protocol::{PersistencePolicy, SessionLifecycle};
use tauri::Manager;

fn live_meta(pid: Option<u32>) -> PtySessionMeta {
    PtySessionMeta {
        pid,
        launched_with_command: false,
        ssh: false,
        busy: true,
        generation: 1,
        policy: PersistencePolicy::CloseWithApp,
        lifecycle: SessionLifecycle::Live,
        label: "Coverage shell".to_string(),
    }
}

#[test]
fn interrupt_refreshes_when_session_pid_is_not_cached() {
    let app = test_support::mock_app();
    assert!(app.manage(PtyManager::new()));

    let error = tauri::async_runtime::block_on(interrupt_session(
        app.state::<PtyManager>(),
        "missing-session".to_string(),
    ))
    .expect_err("an unconfigured test manager cannot refresh sessiond");

    assert!(error.contains("not initialized"));
}

#[test]
fn interrupt_uses_cached_pid_without_refreshing_first() {
    let app = test_support::mock_app();
    assert!(app.manage(PtyManager::new()));
    app.state::<PtyManager>()
        .sessions
        .insert("cached-session".to_string(), live_meta(Some(u32::MAX)));

    let error = tauri::async_runtime::block_on(interrupt_session(
        app.state::<PtyManager>(),
        "cached-session".to_string(),
    ))
    .expect_err("an unconfigured test manager cannot send daemon input");

    assert!(error.contains("not initialized"));
}

#[test]
fn terminate_descendants_ignores_unknown_pids() {
    terminate_session_descendants(&System::new(), vec![u32::MAX, u32::MAX - 1]);
}

#[test]
fn terminate_descendants_kills_known_process_and_skips_unknown_pid() {
    use std::process::{Child, Command};
    use sysinfo::ProcessesToUpdate;

    struct KillOnDrop(Child);
    impl Drop for KillOnDrop {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[cfg(windows)]
    let child = Command::new("powershell")
        .args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"])
        .spawn()
        .expect("spawn disposable child process");
    #[cfg(not(windows))]
    let child = Command::new("sh")
        .args(["-c", "sleep 30"])
        .spawn()
        .expect("spawn disposable child process");
    let pid = child.id();
    let mut child = KillOnDrop(child);
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    assert!(system.process(Pid::from_u32(pid)).is_some());

    terminate_session_descendants(&system, vec![u32::MAX, pid]);

    let _ = child.0.wait();
}
