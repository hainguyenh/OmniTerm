//! End-to-end detach/re-attach against a real shell.
//!
//! The unit tests in `session_output_tests.rs` prove the buffer and the sink swap behave. These
//! prove the property that actually matters to a user popping a pane out: a real PTY keeps running
//! while no window is listening, nothing it printed in the meantime is lost, and none of it leaks to
//! the window that went away.
//!
//! Deliberately outside the Tauri app — the window plumbing needs an event loop, but the part most
//! likely to break silently is this one, and it does not.

mod common;

use app_lib::launch::LocalLaunch;
use app_lib::pty::SessionStatus;
use app_lib::session_output::Output;
use common::native_shell;
use portable_pty::{ChildKiller, CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody, Response};

const TIMEOUT: Duration = Duration::from_secs(20);
/// How long to let the shell finish an `echo` while nothing is attached. Only ever makes the
/// buffering assertion stronger — the marker must be produced inside this window for the test to be
/// proving anything, and `echo` on an already-running shell is orders of magnitude faster.
const DETACHED_SETTLE: Duration = Duration::from_millis(1500);

type Log = Arc<Mutex<String>>;

/// A data channel plus everything it has received, decoded as text.
fn recording_channel() -> (Channel<Response>, Log) {
    let log: Log = Arc::new(Mutex::new(String::new()));
    let sink = Arc::clone(&log);
    let channel = Channel::new(move |body: InvokeResponseBody| {
        if let InvokeResponseBody::Raw(bytes) = body {
            sink.lock().unwrap().push_str(&String::from_utf8_lossy(&bytes));
        }
        Ok(())
    });
    (channel, log)
}

fn status_channel() -> Channel<SessionStatus> {
    Channel::new(|_| Ok(()))
}

fn contains(log: &Log, needle: &str) -> bool {
    log.lock().unwrap().contains(needle)
}

fn wait_until(log: &Log, needle: &str) {
    let deadline = Instant::now() + TIMEOUT;
    while Instant::now() < deadline {
        if contains(log, needle) {
            return;
        }
        thread::sleep(Duration::from_millis(25));
    }
    panic!("timed out waiting for {needle:?}; got:\n{}", log.lock().unwrap());
}

struct Pane {
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    output: Arc<Mutex<Output>>,
    /// Held for the life of the pane, not because anything reads them, but because dropping either
    /// ends the session: the master's Windows impl calls `ClosePseudoConsole`, which tears the PTY
    /// down mid-test. `PtySession` keeps both for the same reason.
    _master: Box<dyn portable_pty::MasterPty + Send>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// Spawn a real shell with exactly ONE reader feeding an `Output`, mirroring
/// `pty::start_local_session`.
///
/// Deliberately not built on `common::start`: that harness spawns its own reader thread, and two
/// readers on the same PTY race for every chunk — the shell banner would land here while the command
/// output went to the harness.
fn start_pane(launch: &LocalLaunch, data: Channel<Response>, label: &str) -> Pane {
    let invocation = launch.invocation().expect("the launch spec should resolve");
    let pair = NativePtySystem::default()
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .expect("a pseudo-terminal should open");

    let mut cmd = CommandBuilder::new(&invocation.exe);
    for arg in &invocation.args {
        cmd.arg(arg);
    }
    let child = pair.slave.spawn_command(cmd).expect("spawn the shell");
    drop(pair.slave); // Without this the reader never sees EOF when the shell exits.

    let mut reader = pair.master.try_clone_reader().expect("clone reader");
    let writer = pair.master.take_writer().expect("take writer");
    let killer = child.clone_killer();
    let output = Arc::new(Mutex::new(Output::new(data, status_channel(), label.into())));

    let pump = Arc::clone(&output);
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            // Note the absence of a "stop if the send failed" branch — that is the whole point.
            app_lib::session_output::push_output(&pump, &buf[..n]);
        }
    });

    Pane {
        writer,
        killer,
        output,
        _master: pair.master,
        _child: child,
    }
}

#[test]
fn a_detached_shell_keeps_running_and_nothing_it_printed_is_lost() {
    let launch = LocalLaunch {
        shell: native_shell(),
        cwd: None,
        args: None,
        command: None,
        keep_open: true,
    };
    let (first_window, first_log) = recording_channel();
    let mut pane = start_pane(&launch, first_window, "test-shell");
    let output = Arc::clone(&pane.output);

    // 1. Attached: output reaches the window that started the session.
    writeln!(pane.writer, "echo BEFORE_DETACH_MARK").unwrap();
    pane.writer.flush().unwrap();
    wait_until(&first_log, "BEFORE_DETACH_MARK");

    // 2. Pop the pane out. The window is gone; the shell is not.
    output.lock().unwrap().detach();
    writeln!(pane.writer, "echo WHILE_DETACHED_MARK").unwrap();
    pane.writer.flush().unwrap();
    thread::sleep(DETACHED_SETTLE);

    // The old window must not receive a byte of it — that is the isolation half of the guarantee.
    assert!(
        !contains(&first_log, "WHILE_DETACHED_MARK"),
        "output leaked to the window the pane was detached from"
    );

    // 3. The new window attaches and gets the scrollback, including what it was never present for.
    let (second_window, second_log) = recording_channel();
    let snapshot = output
        .lock()
        .unwrap()
        .attach(second_window, status_channel());

    assert_eq!(snapshot.status, "ready");
    wait_until(&second_log, "WHILE_DETACHED_MARK");
    assert!(
        contains(&second_log, "BEFORE_DETACH_MARK"),
        "replay should carry scrollback from before the detach too, got:\n{}",
        second_log.lock().unwrap()
    );

    // 4. Live delivery resumes into the new window, and only the new window.
    writeln!(pane.writer, "echo AFTER_REATTACH_MARK").unwrap();
    pane.writer.flush().unwrap();
    wait_until(&second_log, "AFTER_REATTACH_MARK");
    assert!(
        !contains(&first_log, "AFTER_REATTACH_MARK"),
        "the detached window is still receiving output"
    );

    let _ = pane.killer.kill();
}

/// A pane that exits while nobody is attached must report `closed`, not a hopeful `ready` — the
/// re-attaching window renders a reconnect button off this.
#[test]
fn a_session_that_ended_while_detached_reports_closed_on_attach() {
    let (first_window, _) = recording_channel();
    let output = Arc::new(Mutex::new(Output::new(
        first_window,
        status_channel(),
        "test-shell".into(),
    )));

    output.lock().unwrap().detach();
    app_lib::session_output::send_status(&output, SessionStatus::Closed { code: 1 });

    let (second_window, _) = recording_channel();
    let snapshot = output
        .lock()
        .unwrap()
        .attach(second_window, status_channel());
    assert_eq!(snapshot.status, "closed");
}
