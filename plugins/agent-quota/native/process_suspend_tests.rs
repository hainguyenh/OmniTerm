//! Suspending a real process is opt-in (`cargo test -- --ignored`): the default test run never
//! freezes, thaws or kills anything. The child is an ordinary, unrenamed system tool started by
//! this test; nothing is copied or renamed.

use super::*;
use std::process::{Child, Command, Stdio};

fn long_running_child() -> Child {
    let mut command = if cfg!(windows) {
        let mut command = Command::new("ping");
        command.args(["-n", "30", "127.0.0.1"]);
        command
    } else {
        let mut command = Command::new("sleep");
        command.arg("30");
        command
    };
    command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn a long-running child")
}

#[test]
#[ignore = "freezes a real child process; run with --ignored"]
fn suspends_resumes_and_stops_a_real_process() {
    let mut child = long_running_child();
    let pid = child.id();
    let threads = suspend(pid, &[]).expect("suspend");
    if cfg!(windows) {
        assert!(!threads.is_empty(), "at least the main thread is held");
        assert!(
            suspend(pid, &threads).expect("re-scan").is_empty(),
            "held threads are not suspended twice"
        );
    }
    resume(pid, &threads).expect("resume");
    terminate(pid).expect("terminate");
    let status = child.wait().expect("child exits after terminate");
    assert!(!status.success());
}

#[test]
fn a_missing_process_is_an_error_not_a_panic() {
    // No live process has this pid on any supported platform.
    let missing = u32::MAX - 7;
    assert!(suspend(missing, &[]).is_err());
    assert!(terminate(missing).is_err());
    if cfg!(windows) {
        assert!(suspend(missing, &[1]).is_ok_and(|threads| threads.is_empty()));
        assert!(
            resume(missing, &[1, 2]).is_ok(),
            "exited threads are skipped"
        );
    }
}
