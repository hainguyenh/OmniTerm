//! The busy/idle probe against a real shell in a real PTY.
//!
//! The unit tests in `src/proc_activity_tests.rs` cover the traversal rules over a synthetic process
//! table. What they cannot prove is that the table the OS actually hands us looks the way the feature
//! assumes: that an idle shell has no children (in particular that ConPTY's console host is the
//! shell's *sibling*, not its child), and that a command typed at the prompt really does show up.
//!
//! Not covered here: the ticker and the IPC sends, which need a running Tauri app. Everything between
//! them is `resolve_tick`, which is unit-tested.

mod common;

use app_lib::launch::LocalLaunch;
use app_lib::proc_activity::ProcTable;
use std::io::Write;
use std::thread;
use std::time::{Duration, Instant};
use sysinfo::System;

const SETTLE: Duration = Duration::from_secs(20);

fn snapshot() -> ProcTable {
    let mut system = System::new();
    ProcTable::snapshot(&mut system)
}

/// An interactive shell with no command baked in — what a plain "new session" pane runs.
fn interactive() -> LocalLaunch {
    LocalLaunch {
        shell: common::native_shell(),
        cwd: None,
        args: None,
        command: None,
        keep_open: true,
    }
}

/// Poll the real process table until `want` matches, or give up. The probe is a sampled signal, so a
/// test must wait for it the way the poller does rather than assert on a single snapshot.
fn wait_until_busy(pid: u32, want: bool) -> bool {
    let deadline = Instant::now() + SETTLE;
    while Instant::now() < deadline {
        if snapshot().has_descendant(pid) == want {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

/// An idle shell must read idle. If a future Windows reparents the ConPTY console host under the
/// shell, this fails — which is the point: every pane would otherwise be stuck on "running".
#[test]
fn an_idle_shell_has_no_descendants() {
    let mut session = common::start(&interactive());
    let pid = session.child.process_id().expect("the shell should report a pid");

    // Wait for the prompt, so the shell is fully up before we judge it.
    session
        .writer
        .write_all(common::echo_command("READY\r").as_bytes())
        .expect("write");
    session.writer.flush().expect("flush");
    common::wait_for(&session, "READY");

    assert!(
        wait_until_busy(pid, false),
        "an idle shell reported a descendant; process table: {:?}",
        snapshot().descendants(pid),
    );

    let _ = session.killer.kill();
    common::wait_for_exit(&mut session.child);
}

/// A command typed at the prompt is visible as a descendant while it runs, and gone afterwards.
#[test]
fn a_running_command_is_seen_and_then_released() {
    let mut session = common::start(&interactive());
    let pid = session.child.process_id().expect("the shell should report a pid");

    // A few seconds of a real child process, spelled for whichever shell the harness picked.
    let sleeper = if cfg!(target_os = "windows") {
        "ping -n 6 127.0.0.1\r"
    } else {
        "sleep 5\n"
    };
    session.writer.write_all(sleeper.as_bytes()).expect("write");
    session.writer.flush().expect("flush");

    assert!(
        wait_until_busy(pid, true),
        "the running command never appeared as a descendant of {pid}",
    );
    assert!(
        !snapshot().descendants(pid).is_empty(),
        "descendants() must name the child, not merely count it",
    );
    assert!(
        wait_until_busy(pid, false),
        "the shell still reported a descendant after its command finished",
    );

    let _ = session.killer.kill();
    common::wait_for_exit(&mut session.child);
}
