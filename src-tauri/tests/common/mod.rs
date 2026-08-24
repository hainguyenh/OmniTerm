//! Shared harness for the end-to-end shell tests: open a real PTY, spawn a real shell through it,
//! and read what comes back. Lives in `tests/common` so every integration test file can use it —
//! Cargo compiles each `tests/*.rs` as its own crate, so this cannot be a plain `use` of the other.

#![allow(dead_code)] // each test binary uses a different subset of the harness

use app_lib::launch::LocalLaunch;
use app_lib::shell_spec::LocalShell;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

/// Generous, but bounded: a hung shell must fail the test rather than hang CI.
const READ_TIMEOUT: Duration = Duration::from_secs(20);

/// A shell that exists on this platform and can run a one-liner.
pub fn native_shell() -> LocalShell {
    if cfg!(target_os = "windows") {
        LocalShell::Cmd
    } else {
        LocalShell::Sh
    }
}

/// `echo <marker>` for the platform's shell.
pub fn echo_command(marker: &str) -> String {
    format!("echo {marker}")
}

pub struct Session {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub output: mpsc::Receiver<Vec<u8>>,
}

/// Open a PTY and spawn `launch` through it, mirroring `pty::start_local_session`.
pub fn start(launch: &LocalLaunch) -> Session {
    let invocation = launch.invocation().expect("the launch spec should resolve");

    let pair = NativePtySystem::default()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("a pseudo-terminal should open");

    let mut cmd = CommandBuilder::new(&invocation.exe);
    for arg in &invocation.args {
        cmd.arg(arg);
    }
    if let Some(cwd) = &launch.cwd {
        cmd.cwd(cwd);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .unwrap_or_else(|e| panic!("failed to spawn {}: {e}", invocation.exe));
    // Without this the reader never sees EOF when the shell exits.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().expect("clone reader");
    let writer = pair.master.take_writer().expect("take writer");
    let child = child;
    let killer = child.clone_killer();

    let (tx, output) = mpsc::channel();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                break;
            }
        }
    });

    Session {
        master: pair.master,
        writer,
        killer,
        child,
        output,
    }
}

/// Accumulate output until `needle` appears, or fail after `READ_TIMEOUT`.
pub fn wait_for(session: &Session, needle: &str) -> String {
    let deadline = Instant::now() + READ_TIMEOUT;
    let mut seen = String::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            panic!("timed out waiting for {needle:?}; got:\n{seen}");
        }
        match session.output.recv_timeout(remaining) {
            Ok(chunk) => {
                seen.push_str(&String::from_utf8_lossy(&chunk));
                if seen.contains(needle) {
                    return seen;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                panic!("timed out waiting for {needle:?}; got:\n{seen}")
            }
            // The shell exited; whatever it produced is all there is.
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                if seen.contains(needle) {
                    return seen;
                }
                panic!("shell exited before {needle:?} appeared; got:\n{seen}");
            }
        }
    }
}

pub fn wait_for_exit(child: &mut Box<dyn portable_pty::Child + Send + Sync>) -> bool {
    let deadline = Instant::now() + READ_TIMEOUT;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(_) => return false,
        }
    }
    false
}
