//! Running a real script file from a real workspace — the workspace Play button's whole job.

mod common;

use app_lib::launch::LocalLaunch;
use common::{start, wait_for, wait_for_exit};
#[cfg(target_os = "windows")]
use std::io::Write;

/// Running a real script file from a real workspace — the Play button's whole job.
///
/// This is the test the unit tests could not be: both bugs behind "'"D:\ws\stop.bat"' is not recognized
/// as an internal or external command" were invisible to `script_run_request` assertions written with
/// hand-made paths. First `fs::canonicalize` handed cmd.exe a `\\?\` verbatim path; then the path was
/// quoted here as well as by the spawner, so cmd received `\"D:\ws\x.bat\"`. The directory name has a
/// space in it precisely because that is the case quoting exists for.
#[test]
fn runs_a_real_script_file_from_its_workspace() {
    let dir = tempfile::Builder::new()
        .prefix("omniterm run")
        .tempdir()
        .expect("temp dir");
    let root = dunce::canonicalize(dir.path()).expect("canonical");

    let (name, body) = if cfg!(target_os = "windows") {
        ("marker.bat", "@echo off\r\necho OMNITERM_SCRIPT_OK\r\n")
    } else {
        ("marker.sh", "#!/bin/sh\necho OMNITERM_SCRIPT_OK\n")
    };
    let script = root.join(name);
    std::fs::write(&script, body).expect("write script");

    // Exactly what `workspace::run_script` does: containment-check the path, then build the request.
    let real =
        app_lib::safepath::safe_runnable_path(&root.to_string_lossy(), &script.to_string_lossy())
            .expect("the script is inside its workspace");
    let kind = if cfg!(target_os = "windows") {
        "bat"
    } else {
        "sh"
    };
    let request = app_lib::workspace_launch::script_run_request(
        kind,
        &real.to_string_lossy(),
        name,
        &root.to_string_lossy(),
    );

    let launch = LocalLaunch {
        shell: request.shell,
        cwd: request.cwd,
        args: request.args,
        command: request.command,
        keep_open: request.keep_open,
    };
    let mut session = start(&launch);

    let output = wait_for(&session, "OMNITERM_SCRIPT_OK");
    assert!(output.contains("OMNITERM_SCRIPT_OK"), "got:\n{output}");
    assert!(
        !output.contains("is not recognized"),
        "cmd could not resolve the script path:\n{output}"
    );
    let _ = wait_for_exit(&mut session.child);
}

/// The other half of a script run: the script asks for a keypress before it lets go.
///
/// `pause` is the last line of most hand-written `.bat` files, so this is the shape of nearly every
/// real run: output, then a shell blocked on one key, then exit. It is asserted end to end because the
/// pane looked frozen at exactly this point, and the question "did the keystroke reach the PTY at all"
/// could not be answered from the renderer. It does reach it — provided the pane has keyboard focus and
/// the shell is already reading, which is what the renderer side of this fix is about.
#[cfg(target_os = "windows")]
#[test]
fn a_keystroke_answers_a_script_waiting_on_pause_and_the_shell_exits() {
    let dir = tempfile::Builder::new()
        .prefix("omniterm pause")
        .tempdir()
        .expect("temp dir");
    let root = dunce::canonicalize(dir.path()).expect("canonical");
    let script = root.join("pause.bat");
    std::fs::write(
        &script,
        "@echo off\r\necho OMNITERM_BEFORE_PAUSE\r\npause\r\necho OMNITERM_AFTER_PAUSE\r\n",
    )
    .expect("write script");

    let request = app_lib::workspace_launch::script_run_request(
        "bat",
        &script.to_string_lossy(),
        "pause.bat",
        &root.to_string_lossy(),
    );
    let launch = LocalLaunch {
        shell: request.shell,
        cwd: request.cwd,
        args: request.args,
        command: request.command,
        keep_open: request.keep_open,
    };
    let mut session = start(&launch);

    // Waiting for the prompt itself, not just the line before it: a byte written before `pause` starts
    // reading is not buffered for it, and the script sits there forever.
    wait_for(&session, "Press any key");
    session.writer.write_all(b" ").expect("write a keystroke");
    session.writer.flush().expect("flush");

    let output = wait_for(&session, "OMNITERM_AFTER_PAUSE");
    assert!(output.contains("OMNITERM_AFTER_PAUSE"), "got:\n{output}");
    // keep_open is false for a script run, so the pane's shell must go once the script is done —
    // that exit is what closes the tab (see src/sessionExit.ts).
    assert!(
        wait_for_exit(&mut session.child),
        "the shell should exit once the script finishes"
    );
}
