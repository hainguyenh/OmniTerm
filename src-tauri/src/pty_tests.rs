use super::*;
use crate::adhoc::AdhocRegistry;
use crate::openshell::OpenShellRequest;
use crate::shell_spec::LocalShell;
use crate::test_support;
use tauri::ipc::InvokeResponseBody;
use tauri::Manager;
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// The platform's own shell, mirroring `tests/common/mod.rs::native_shell` — `cmd`/`sh` are the two
/// shells whose `resolve_exe()` succeeds on their respective CI runners without depending on what
/// else happens to be installed.
fn native_shell() -> LocalShell {
    if cfg!(target_os = "windows") {
        LocalShell::Cmd
    } else {
        LocalShell::Sh
    }
}

fn recording_channel() -> (Channel<Response>, mpsc::Receiver<Vec<u8>>) {
    let (tx, rx) = mpsc::channel();
    let channel = Channel::new(move |body: InvokeResponseBody| {
        if let InvokeResponseBody::Raw(bytes) = body {
            let _ = tx.send(bytes);
        }
        Ok(())
    });
    (channel, rx)
}

fn status_channel() -> (Channel<SessionStatus>, mpsc::Receiver<SessionStatus>) {
    let (tx, rx) = mpsc::channel();
    let channel = Channel::new(move |body: InvokeResponseBody| {
        if let InvokeResponseBody::Json(text) = body {
            if let Ok(status) = serde_json::from_str::<SessionStatus>(&text) {
                let _ = tx.send(status);
            }
        }
        Ok(())
    });
    (channel, rx)
}

#[test]
fn ignores_kill_errors_for_sessions_that_already_exited() {
    let missing = std::io::Error::from(std::io::ErrorKind::NotFound);
    let other = std::io::Error::other("permission denied");

    assert!(is_process_gone_error(&missing));
    assert!(!is_process_gone_error(&other));
}

#[cfg(windows)]
#[test]
fn ignores_windows_invalid_handle_from_an_already_exited_session() {
    let invalid_handle = std::io::Error::from_raw_os_error(6);
    assert!(is_process_gone_error(&invalid_handle));
}

#[test]
fn colorfgbg_matches_the_terminal_appearance() {
    assert_eq!(colorfgbg_for_dark_mode(Some(true)), Some("15;0"));
    assert_eq!(colorfgbg_for_dark_mode(Some(false)), Some("0;15"));
    assert_eq!(colorfgbg_for_dark_mode(None), None);
}

/// Runs a real, self-terminating shell command through the actual command — not a reimplementation
/// of its spawn logic — and follows it through Ready, output, and Closed. This is the single largest
/// uncovered function in the crate: `tests/common/mod.rs` deliberately mirrors this function's PTY
/// setup for the integration tests rather than calling it, so none of that coverage ever counted here.
#[test]
fn start_local_session_runs_a_real_shell_through_its_full_lifecycle() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    assert!(app.manage(PtyManager::new()));
    assert!(app.manage(AdhocRegistry::new()));
    let handle = app.handle().clone();

    let marker = "omniterm-coverage-marker";
    handle.state::<AdhocRegistry>().insert_named(
        "adhoc-coverage".to_string(),
        OpenShellRequest {
            shell: native_shell(),
            cwd: None,
            command: Some(format!("echo {marker}")),
            args: None,
            keep_open: false,
            name: "Coverage".to_string(),
        },
    );

    let (on_data, data_rx) = recording_channel();
    let (on_status, status_rx) = status_channel();
    let manager = handle.state::<PtyManager>();

    tauri::async_runtime::block_on(start_local_session(
        handle.clone(),
        manager.clone(),
        "session-coverage".to_string(),
        "adhoc-coverage".to_string(),
        None,
        None,
        on_data,
        on_status,
    ))
    .expect("a plain echo through the native shell should start");

    let deadline = Instant::now() + Duration::from_secs(20);
    let mut saw_ready = false;
    let mut closed_code = None;
    while Instant::now() < deadline && closed_code.is_none() {
        if let Ok(status) = status_rx.recv_timeout(Duration::from_millis(200)) {
            match status {
                SessionStatus::Ready { .. } => saw_ready = true,
                SessionStatus::Closed { code } => closed_code = Some(code),
                _ => {}
            }
        }
    }
    assert!(saw_ready, "expected a Ready status before Closed");
    assert_eq!(closed_code, Some(0), "echo should exit cleanly");

    let mut seen = String::new();
    while let Ok(bytes) = data_rx.try_recv() {
        seen.push_str(&String::from_utf8_lossy(&bytes));
    }
    assert!(
        seen.contains(marker),
        "expected the echoed marker in the session's output, got: {seen:?}"
    );

    // The exit-watcher removes the session before it sends `Closed` — already observed above.
    assert!(manager.sessions.get("session-coverage").is_none());
}

#[test]
fn manager_defaults_empty_and_missing_session_commands_fail_cleanly() {
    let app = test_support::mock_app();
    assert!(app.manage(PtyManager::new()));
    let manager = app.state::<PtyManager>();
    assert!(manager.sessions.is_empty());

    assert_eq!(
        tauri::async_runtime::block_on(send_session_input(
            manager.clone(),
            "missing".to_string(),
            "data".to_string(),
        ))
        .unwrap_err(),
        "Session not found"
    );
    assert_eq!(
        tauri::async_runtime::block_on(resize_session(
            manager.clone(),
            "missing".to_string(),
            0,
            24,
        ))
        .unwrap_err(),
        "Terminal size must be non-zero"
    );
    assert_eq!(
        tauri::async_runtime::block_on(resize_session(
            manager.clone(),
            "missing".to_string(),
            80,
            24,
        ))
        .unwrap_err(),
        "Session not found"
    );
    assert_eq!(
        tauri::async_runtime::block_on(disconnect_session(
            manager.clone(),
            "missing".to_string(),
        ))
        .unwrap_err(),
        "Session not found"
    );

    kill_session(&manager, "missing");
    assert!(manager.sessions.is_empty());
}

#[test]
fn pane_path_prepends_the_launcher_directory_and_preserves_existing_path() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let original = std::env::var_os("PATH");
    std::env::set_var("PATH", std::env::join_paths(["/one", "/two"]).unwrap());

    let combined = path_with_helper(&handle).expect("PATH should be composed");
    let parts = std::env::split_paths(&combined).collect::<Vec<_>>();
    assert_eq!(parts.first(), Some(&launcher::launcher_bin_dir(&handle)));
    assert!(parts.iter().any(|path| path == std::path::Path::new("/one")));
    assert!(parts.iter().any(|path| path == std::path::Path::new("/two")));

    match original {
        Some(value) => std::env::set_var("PATH", value),
        None => std::env::remove_var("PATH"),
    }
}

#[test]
fn pane_path_is_none_when_path_is_absent() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let original = std::env::var_os("PATH");
    std::env::remove_var("PATH");
    assert!(path_with_helper(&handle).is_none());
    if let Some(value) = original {
        std::env::set_var("PATH", value);
    }
}

#[test]
fn pty_manager_default_initializes_with_empty_sessions() {
    let mgr = PtyManager::default();
    assert!(mgr.sessions.is_empty(), "new PtyManager must have no sessions");
}

fn wait_for_status(
    receiver: &mpsc::Receiver<SessionStatus>,
    predicate: impl Fn(&SessionStatus) -> bool,
) -> SessionStatus {
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if let Ok(status) = receiver.recv_timeout(Duration::from_millis(200)) {
            if predicate(&status) {
                return status;
            }
        }
    }
    panic!("timed out waiting for session status");
}

#[test]
fn live_session_accepts_input_resize_and_same_id_replacement() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    assert!(app.manage(PtyManager::new()));
    assert!(app.manage(AdhocRegistry::new()));
    let handle = app.handle().clone();
    let manager = handle.state::<PtyManager>();

    handle.state::<AdhocRegistry>().insert_named(
        "adhoc-interactive".into(),
        OpenShellRequest {
            shell: native_shell(), cwd: None, command: None, args: None,
            keep_open: true, name: "Interactive".into(),
        },
    );
    let (data, data_rx) = recording_channel();
    let (status, status_rx) = status_channel();
    tauri::async_runtime::block_on(start_local_session(
        handle.clone(), manager.clone(), "replace-me".into(),
        "adhoc-interactive".into(), None, None, data, status,
    )).unwrap();
    wait_for_status(&status_rx, |status| matches!(status, SessionStatus::Ready { .. }));
    tauri::async_runtime::block_on(resize_session(
        manager.clone(), "replace-me".into(), 100, 40,
    )).unwrap();
    tauri::async_runtime::block_on(send_session_input(
        manager.clone(), "replace-me".into(),
        if cfg!(target_os = "windows") { "echo live-input\r\n" } else { "echo live-input\n" }.into(),
    )).unwrap();
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut first_output = String::new();
    while Instant::now() < deadline && !first_output.contains("live-input") {
        if let Ok(bytes) = data_rx.recv_timeout(Duration::from_millis(200)) {
            first_output.push_str(&String::from_utf8_lossy(&bytes));
        }
    }
    assert!(first_output.contains("live-input"), "{first_output:?}");

    handle.state::<AdhocRegistry>().insert_named(
        "adhoc-replacement".into(),
        OpenShellRequest {
            shell: native_shell(), cwd: None, command: Some("echo replacement".into()), args: None,
            keep_open: false, name: "Replacement".into(),
        },
    );
    let (replacement_data, replacement_rx) = recording_channel();
    let (replacement_status, replacement_status_rx) = status_channel();
    tauri::async_runtime::block_on(start_local_session(
        handle.clone(), manager.clone(), "replace-me".into(),
        "adhoc-replacement".into(), None, None, replacement_data, replacement_status,
    )).unwrap();
    wait_for_status(&replacement_status_rx, |status| matches!(status, SessionStatus::Closed { .. }));

    let mut replacement = String::new();
    while let Ok(bytes) = replacement_rx.try_recv() {
        replacement.push_str(&String::from_utf8_lossy(&bytes));
    }
    assert!(replacement.contains("replacement"), "{replacement:?}");
}

#[test]
fn poisoned_session_locks_report_errors_and_disconnect_still_cleans_registry() {
    use std::panic::{catch_unwind, AssertUnwindSafe};

    let _guard = test_support::lock();
    let app = test_support::mock_app();
    assert!(app.manage(PtyManager::new()));
    assert!(app.manage(AdhocRegistry::new()));
    let handle = app.handle().clone();
    let manager = handle.state::<PtyManager>();
    handle.state::<AdhocRegistry>().insert_named(
        "adhoc-poison".into(),
        OpenShellRequest {
            shell: native_shell(), cwd: None, command: None, args: None,
            keep_open: true, name: "Poison".into(),
        },
    );
    let (data, _) = recording_channel();
    let (status, status_rx) = status_channel();
    tauri::async_runtime::block_on(start_local_session(
        handle.clone(), manager.clone(), "poisoned".into(), "adhoc-poison".into(), None, None, data, status,
    )).unwrap();
    wait_for_status(&status_rx, |status| matches!(status, SessionStatus::Ready { .. }));

    let (writer, master, killer) = {
        let session = manager.sessions.get("poisoned").unwrap();
        (
            Arc::clone(&session.writer),
            Arc::clone(&session.master),
            Arc::clone(&session.killer),
        )
    };
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let _guard = writer.lock().unwrap();
        panic!("poison writer");
    }));
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let _guard = master.lock().unwrap();
        panic!("poison master");
    }));
    assert_eq!(
        tauri::async_runtime::block_on(send_session_input(
            manager.clone(), "poisoned".into(), "ignored".into(),
        )).unwrap_err(),
        "Failed to acquire writer lock"
    );
    assert_eq!(
        tauri::async_runtime::block_on(resize_session(
            manager.clone(), "poisoned".into(), 80, 24,
        )).unwrap_err(),
        "Failed to acquire master lock"
    );

    let _ = catch_unwind(AssertUnwindSafe(|| {
        let _guard = killer.lock().unwrap();
        panic!("poison killer");
    }));
    tauri::async_runtime::block_on(disconnect_session(manager.clone(), "poisoned".into())).unwrap();
    assert!(!manager.sessions.contains_key("poisoned"));
    let _ = killer.lock().unwrap_or_else(|error| error.into_inner()).kill();
}
