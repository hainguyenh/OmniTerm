use super::*;
use super::tests::entry;
use crate::adhoc::AdhocRegistry;
use crate::openshell::OpenShellRequest;
use crate::pty::{self, PtyManager};
use crate::shell_spec::LocalShell;
use crate::test_support;
use tauri::ipc::InvokeResponseBody;

fn discarding_channel() -> Channel<Response> {
    Channel::new(|_body: InvokeResponseBody| Ok(()))
}

fn status_channel() -> (Channel<SessionStatus>, std::sync::mpsc::Receiver<SessionStatus>) {
    let (tx, rx) = std::sync::mpsc::channel();
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

/// Kills the session on drop, so a panicked assertion never leaves a lingering interactive shell
/// process behind on the machine running the test.
struct KillOnDrop<'a> {
    manager: &'a PtyManager,
    id: String,
}

impl Drop for KillOnDrop<'_> {
    fn drop(&mut self) {
        pty::kill_session(self.manager, &self.id);
    }
}

/// The happy-path branches that need a real window and a real live session: `detach_terminal`'s
/// window-build success, `bootstrap_terminal_window`'s `Some(...)`, `attach_session`'s
/// `Some(session)`, `focus_terminal_window`'s `Some(window)`, and `reattach_terminal`'s `Some(window)`
/// (closing a still-tracked mock window — `MockRuntime` has no real event loop to remove it from the
/// manager's bookkeeping on `close()`, so this is the only branch reachable there; the "window already
/// gone" branch is covered separately by the "missing" registry-entry tests above finding nothing to
/// close in the first place).
#[test]
fn happy_paths_through_a_real_session_and_a_real_mock_window() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    assert!(app.manage(PtyManager::new()));
    assert!(app.manage(AdhocRegistry::new()));
    let handle = app.handle().clone();

    let shell = if cfg!(target_os = "windows") {
        LocalShell::Cmd
    } else {
        LocalShell::Sh
    };
    handle.state::<AdhocRegistry>().insert_named(
        "adhoc-terminal-window".to_string(),
        OpenShellRequest {
            shell,
            cwd: None,
            command: None,
            args: None,
            keep_open: true,
            name: "Coverage".to_string(),
        },
    );

    let pty_state = handle.state::<PtyManager>();
    let session_id = "session-terminal-window".to_string();
    let _kill_guard = KillOnDrop {
        manager: &pty_state,
        id: session_id.clone(),
    };

    let (ready_status, ready_rx) = status_channel();
    tauri::async_runtime::block_on(pty::start_local_session(
        handle.clone(),
        pty_state.clone(),
        session_id.clone(),
        "adhoc-terminal-window".to_string(),
        None,
        discarding_channel(),
        ready_status,
    ))
    .expect("an interactive native shell should start");

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    let mut ready = false;
    while std::time::Instant::now() < deadline && !ready {
        if let Ok(SessionStatus::Ready { .. }) = ready_rx.recv_timeout(std::time::Duration::from_millis(200)) {
            ready = true;
        }
    }
    assert!(ready, "session should report Ready before the test proceeds");

    let registry = handle.state::<DetachRegistry>();
    let detached = tauri::async_runtime::block_on(detach_terminal(
        handle.clone(),
        registry.clone(),
        pty_state.clone(),
        session_id.clone(),
        "Coverage".to_string(),
        serde_json::json!({"id": "adhoc-terminal-window"}),
    ))
    .unwrap();
    assert!(detached, "detach should succeed against a live session");

    let window_label = registry
        .entries
        .get(&session_id)
        .expect("detach should have registered an entry")
        .window_label
        .clone();
    let webview_window = handle
        .get_webview_window(&window_label)
        .expect("the window detach_terminal built should be reachable");
    let window: tauri::Window<_> =
        AsRef::<tauri::Webview<_>>::as_ref(&webview_window).window();

    let bootstrap = tauri::async_runtime::block_on(bootstrap_terminal_window(window.clone(), registry.clone()))
        .unwrap()
        .expect("the detached window should resolve its own session");
    assert_eq!(bootstrap.session_id, session_id);
    assert_eq!(bootstrap.name, "Coverage");

    let snapshot = tauri::async_runtime::block_on(attach_session(
        pty_state.clone(),
        session_id.clone(),
        discarding_channel(),
        status_channel().0,
    ))
    .unwrap();
    assert!(snapshot.is_some(), "attach should find the live session");

    tauri::async_runtime::block_on(focus_terminal_window(handle.clone(), registry.clone(), session_id.clone()))
        .unwrap();

    let reattached = tauri::async_runtime::block_on(reattach_terminal(handle.clone(), registry.clone(), session_id.clone()))
        .unwrap();
    assert!(reattached, "reattach should close the still-tracked mock window");
    assert!(
        registry
            .entries
            .get(&session_id)
            .expect("mock close() does not fire Destroyed, so the entry is not folded back yet")
            .folding_back
            .load(Ordering::SeqCst),
        "reattach must mark the entry as folding back before closing the window"
    );

    // Reset folding_back and fire on_window_destroyed to hit the session_is_busy path
    // with a real, live session.
    registry.entries.get(&session_id).unwrap().folding_back.store(false, Ordering::SeqCst);
    on_window_destroyed(&handle, &session_id);
    assert!(!registry.entries.contains_key(&session_id), "busy session should be folded back and removed");
}

#[test]
fn detach_terminal_rejects_already_detached_session() {
    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    assert!(app.manage(PtyManager::new()));
    let registry = app.state::<DetachRegistry>();
    registry.entries.insert("session".to_string(), entry("term-1", "Coverage"));
    let handle = app.handle().clone();

    let detached = tauri::async_runtime::block_on(detach_terminal(
        handle,
        registry.clone(),
        app.state::<PtyManager>(),
        "session".to_string(),
        "Coverage".to_string(),
        serde_json::json!({"id": "session"}),
    )).unwrap();
    assert!(!detached);
}

#[test]
fn attach_session_returns_none_if_session_is_missing() {
    let app = test_support::mock_app();
    assert!(app.manage(PtyManager::new()));
    let snapshot = tauri::async_runtime::block_on(attach_session(
        app.state::<PtyManager>(),
        "missing".to_string(),
        discarding_channel(),
        status_channel().0,
    )).unwrap();
    assert!(snapshot.is_none());
}

#[test]
fn on_window_destroyed_returns_silently_if_registry_is_missing() {
    let app = test_support::mock_app();
    on_window_destroyed(&app.handle().clone(), "session");
}

#[test]
fn focus_terminal_window_silently_ignores_missing_window() {
    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    let registry = app.state::<DetachRegistry>();
    registry.entries.insert("session".to_string(), entry("term-999", "Coverage"));

    tauri::async_runtime::block_on(focus_terminal_window(
        app.handle().clone(),
        registry,
        "session".to_string(),
    )).unwrap();
}

#[test]
fn on_window_destroyed_kills_missing_session_without_panic() {
    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    let registry = app.state::<DetachRegistry>();
    registry.entries.insert("session".to_string(), entry("term-1", "Coverage"));

    on_window_destroyed(&app.handle().clone(), "session");
    assert!(!registry.entries.contains_key("session"));
}

#[test]
fn on_window_destroyed_folds_if_folding_back_is_set() {
    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    let handle = app.handle().clone();
    let registry = app.state::<DetachRegistry>();

    let entry = DetachEntry {
        window_label: "term-1".to_string(),
        name: "test".to_string(),
        connection: serde_json::json!({}),
        folding_back: AtomicBool::new(true),
    };
    registry.entries.insert("session".to_string(), entry);

    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "main",
        tauri::WebviewUrl::App("index.html".into())
    ).build().unwrap();

    on_window_destroyed(&handle, "session");

    assert!(!registry.entries.contains_key("session"));
}

#[test]
fn finish_reattach_handles_missing_registry() {
    let app = test_support::mock_app();
    finish_reattach(&app.handle().clone(), "session");
}
