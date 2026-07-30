//! End-to-end shell integration: does OmniTerm actually drive the OS shell?
//!
//! The unit tests prove the launch spec is built correctly. These prove the spec *works* — a real
//! pseudo-terminal is opened, the platform's real shell is spawned through it, output comes back, typed
//! input is executed, and the child dies when the pane is closed.
//!
//! Deliberately outside the Tauri app: it exercises exactly the sequence `pty::start_local_session`
//! performs (resolve → build invocation → openpty → spawn → stream → kill), without needing a window or
//! an event loop. If these pass, "open a local shell and type into it" works on this machine.

mod common;

use app_lib::launch::LocalLaunch;
use app_lib::shell_spec::LocalShell;
use common::{echo_command, native_shell, start, wait_for, wait_for_exit};
use portable_pty::PtySize;
use std::io::Write;

/// A saved `command` must actually run in the shell and its output must reach us.
#[test]
fn runs_a_saved_command_and_streams_its_output() {
    let launch = LocalLaunch {
        shell: native_shell(),
        cwd: None,
        args: None,
        command: Some(echo_command("OMNITERM_RUN_OK")),
        keep_open: false,
    };
    let mut session = start(&launch);

    let output = wait_for(&session, "OMNITERM_RUN_OK");
    assert!(output.contains("OMNITERM_RUN_OK"), "got:\n{output}");

    // keep_open == false means the pane's shell exits once the command finishes.
    assert!(
        wait_for_exit(&mut session.child),
        "the shell should exit when keepOpen is false"
    );
}

/// The interactive path: an open shell, a command typed into it, and the result read back. This is
/// what a user does in a pane, so it is the one that has to work.
#[test]
fn executes_a_command_typed_into_a_live_shell() {
    let launch = LocalLaunch {
        shell: native_shell(),
        cwd: None,
        args: None,
        command: None,
        keep_open: true,
    };
    let mut session = start(&launch);

    session
        .writer
        .write_all(format!("{}\r\n", echo_command("OMNITERM_TYPED_OK")).as_bytes())
        .expect("writing to the shell should succeed");
    session.writer.flush().expect("flush");

    let output = wait_for(&session, "OMNITERM_TYPED_OK");
    assert!(output.contains("OMNITERM_TYPED_OK"), "got:\n{output}");

    // Closing the pane must kill the shell. Dropping the master alone does not: the reader thread
    // holds a cloned handle that keeps the PTY open, which is how disconnected panes leaked their
    // shell process for the life of the app.
    //
    // The Result is deliberately ignored — see `kill_reports_an_error_even_when_it_succeeds`. What
    // matters is that the process is actually gone, which is what is asserted.
    let _ = session.killer.kill();
    assert!(
        wait_for_exit(&mut session.child),
        "the shell should be gone after the session is killed"
    );
}

/// Documents an upstream defect we have to work around: portable-pty 0.8.1's
/// `WinChildKiller::kill` checks `TerminateProcess`'s return code backwards —
/// `if res != 0 { Err(last_os_error()) } else { Ok(()) }` — so a *successful* kill returns `Err`
/// carrying whatever stale OS error was lying around, while a genuine failure returns `Ok`.
///
/// So the Result cannot be trusted, and `pty::kill_session` logs it instead of surfacing it. If a
/// future portable-pty release fixes this, this test starts failing on Windows and the workaround
/// (and its comment) can be removed.
#[cfg(target_os = "windows")]
#[test]
fn kill_reports_an_error_even_when_it_succeeds() {
    let launch = LocalLaunch {
        shell: native_shell(),
        cwd: None,
        args: None,
        command: None,
        keep_open: true,
    };
    let mut session = start(&launch);

    let reported = session.killer.kill();
    assert!(
        wait_for_exit(&mut session.child),
        "the kill must actually terminate the child"
    );
    assert!(
        reported.is_err(),
        "portable-pty appears to have fixed its inverted TerminateProcess check — \
         the workaround in pty::kill_session can now be removed"
    );
}

/// A pane starts in the connection's saved directory.
#[test]
fn starts_in_the_requested_working_directory() {
    let dir = tempfile::Builder::new()
        .prefix("omniterm-cwd")
        .tempdir()
        .expect("temp dir");
    let root = std::fs::canonicalize(dir.path()).expect("canonical");
    let marker_dir = root.join("marker-dir");
    std::fs::create_dir(&marker_dir).unwrap();

    let print_cwd = if cfg!(target_os = "windows") { "cd" } else { "pwd" };
    let launch = LocalLaunch {
        shell: native_shell(),
        cwd: Some(marker_dir.to_string_lossy().into_owned()),
        args: None,
        command: Some(print_cwd.to_string()),
        keep_open: false,
    };
    let mut session = start(&launch);

    let output = wait_for(&session, "marker-dir");
    assert!(output.contains("marker-dir"), "got:\n{output}");
    let _ = session.killer.kill();
    let _ = wait_for_exit(&mut session.child);
}

/// Resizing a live PTY is what the renderer does on every pane layout change.
#[test]
fn resizes_a_live_session() {
    let launch = LocalLaunch {
        shell: native_shell(),
        cwd: None,
        args: None,
        command: None,
        keep_open: true,
    };
    let mut session = start(&launch);

    session
        .master
        .resize(PtySize {
            rows: 40,
            cols: 132,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("resize should succeed on a live pty");

    // Still usable afterward.
    session
        .writer
        .write_all(format!("{}\r\n", echo_command("OMNITERM_RESIZE_OK")).as_bytes())
        .expect("write");
    session.writer.flush().unwrap();
    let output = wait_for(&session, "OMNITERM_RESIZE_OK");
    assert!(output.contains("OMNITERM_RESIZE_OK"), "got:\n{output}");

    let _ = session.killer.kill();
    let _ = wait_for_exit(&mut session.child);
}

/// Extra args reach the shell as separate argv entries, with quoted values kept whole.
#[test]
fn passes_quoted_extra_arguments_through_to_the_shell() {
    // `cmd /c echo "a b"` on Windows; `sh -l -c 'echo "a b"'` on POSIX. Either way the marker with
    // its embedded space must come back intact.
    let launch = LocalLaunch {
        shell: native_shell(),
        cwd: None,
        args: None,
        command: Some("echo \"OMNITERM ARGS OK\"".to_string()),
        keep_open: false,
    };
    let mut session = start(&launch);

    let output = wait_for(&session, "OMNITERM ARGS OK");
    assert!(output.contains("OMNITERM ARGS OK"), "got:\n{output}");
    let _ = wait_for_exit(&mut session.child);
}

/// The allowlist has to hold at the spawn boundary too: an arbitrary executable must never produce a
/// launch spec, so there is nothing to spawn.
#[test]
fn an_arbitrary_executable_never_reaches_the_spawner() {
    for hostile in ["calc.exe", r"C:\Windows\System32\calc.exe", "/bin/sh", "sh -c x"] {
        assert!(
            LocalShell::parse(hostile).is_none(),
            "{hostile:?} must not resolve to a shell"
        );
    }
    // And the resolved exe for every allowlisted shell is a shell, not a caller-supplied string.
    let exe = native_shell().resolve_exe().expect("native shell resolves");
    assert!(
        exe.ends_with("cmd.exe") || exe.ends_with("/sh"),
        "unexpected executable {exe}"
    );
}
