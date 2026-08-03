//! Registry bookkeeping. The window-lifecycle half needs a real Tauri runtime and is covered by the
//! manual checks in the plan; what is unit-testable here is the part most likely to rot silently —
//! label minting and the calling-window lookup that stops one webview asking about another.

use super::*;
use crate::adhoc::AdhocRegistry;
use crate::openshell::OpenShellRequest;
use crate::pty::{self, PtyManager};
use crate::shell_spec::LocalShell;
use crate::test_support;
use tauri::ipc::InvokeResponseBody;

fn entry(label: &str, name: &str) -> DetachEntry {
    DetachEntry {
        window_label: label.to_string(),
        name: name.to_string(),
        connection: serde_json::json!({ "id": "c1", "type": "LOCAL" }),
        folding_back: AtomicBool::new(false),
    }
}

#[test]
fn labels_are_unique_and_carry_the_granted_prefix() {
    let registry = DetachRegistry::new();
    let labels: Vec<String> = (0..5).map(|_| registry.mint_label()).collect();

    // capabilities/default.json grants `term-*`; a label outside it gets no permissions at all and
    // the window would come up unable to call a single command.
    assert!(labels.iter().all(|l| l.starts_with(LABEL_PREFIX)));
    let unique: std::collections::HashSet<_> = labels.iter().collect();
    assert_eq!(unique.len(), labels.len(), "labels collided: {labels:?}");
}

/// A LOCAL pane's session id is `<connId>_<uuid>` — outside the character set Tauri accepts for a
/// window label, which is why labels are minted rather than derived.
#[test]
fn a_session_id_is_never_used_as_a_label() {
    let registry = DetachRegistry::new();
    let session_id = "8f14e45f_a3b1c2d4";
    registry.entries.insert(session_id.to_string(), entry(&registry.mint_label(), "WSL"));

    let stored = registry.entries.get(session_id).unwrap();
    assert_ne!(stored.window_label, session_id);
    assert!(stored
        .window_label
        .trim_start_matches(LABEL_PREFIX)
        .chars()
        .all(|c| c.is_ascii_digit()));
}

#[test]
fn resolves_a_session_from_its_own_window_label_only() {
    let registry = DetachRegistry::new();
    registry.entries.insert("session-a".into(), entry("term-1", "One"));
    registry.entries.insert("session-b".into(), entry("term-2", "Two"));

    assert_eq!(registry.session_for_window("term-1").as_deref(), Some("session-a"));
    assert_eq!(registry.session_for_window("term-2").as_deref(), Some("session-b"));
    // `main` owns no detached session, so bootstrap from it must reveal nothing.
    assert_eq!(registry.session_for_window("main"), None);
    assert_eq!(registry.session_for_window("term-99"), None);
}

#[test]
fn shutdown_latches_so_teardown_never_runs_the_close_branch() {
    let registry = DetachRegistry::new();
    assert!(!registry.shutting_down.load(Ordering::SeqCst));
    registry.begin_shutdown();
    assert!(registry.shutting_down.load(Ordering::SeqCst));
}

#[test]
fn folding_back_is_recorded_per_session() {
    let registry = DetachRegistry::new();
    registry.entries.insert("session-a".into(), entry("term-1", "One"));
    registry.entries.insert("session-b".into(), entry("term-2", "Two"));

    registry
        .entries
        .get("session-a")
        .unwrap()
        .folding_back
        .store(true, Ordering::SeqCst);

    assert!(registry.entries.get("session-a").unwrap().folding_back.load(Ordering::SeqCst));
    assert!(!registry.entries.get("session-b").unwrap().folding_back.load(Ordering::SeqCst));
}

#[test]
fn mock_runtime_covers_missing_session_and_registry_command_paths() {
    use tauri::Manager;

    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    assert!(app.manage(PtyManager::new()));
    let handle = app.handle().clone();
    let registry = app.state::<DetachRegistry>();
    let pty = app.state::<PtyManager>();

    let detached = tauri::async_runtime::block_on(detach_terminal(
        handle.clone(),
        registry.clone(),
        pty,
        "missing".to_string(),
        "Missing".to_string(),
        serde_json::json!({"id": "missing"}),
    ))
    .unwrap();
    assert!(!detached);

    assert!(!tauri::async_runtime::block_on(reattach_terminal(
        handle.clone(),
        registry.clone(),
        "missing".to_string(),
    ))
    .unwrap());
    tauri::async_runtime::block_on(focus_terminal_window(
        handle.clone(),
        registry.clone(),
        "missing".to_string(),
    ))
    .unwrap();
    tauri::async_runtime::block_on(release_terminal_window(
        registry,
        "missing".to_string(),
    ))
    .unwrap();

    assert!(!session_is_busy(&handle, "missing"));
    on_window_destroyed(&handle, "missing");
    finish_reattach(&handle, "missing");
}

#[test]
fn destroyed_window_respects_shutdown_and_finish_reattach_removes_the_entry() {
    use tauri::Manager;

    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    assert!(app.manage(PtyManager::new()));
    let handle = app.handle().clone();
    let registry = app.state::<DetachRegistry>();
    registry
        .entries
        .insert("session".to_string(), entry("term-1", "Coverage"));

    registry.begin_shutdown();
    on_window_destroyed(&handle, "session");
    assert!(registry.entries.contains_key("session"));

    registry.shutting_down.store(false, Ordering::SeqCst);
    registry
        .entries
        .get("session")
        .unwrap()
        .folding_back
        .store(true, Ordering::SeqCst);
    on_window_destroyed(&handle, "session");
    assert!(!registry.entries.contains_key("session"));
}

/// The one remaining branch of `on_window_destroyed`: not shutting down, not an explicit re-attach,
/// and not busy (no live `PtyManager` session at all reads the same as idle) — the window's own X
/// button on an idle pane, which should forget the session outright rather than fold it back.
#[test]
fn on_window_destroyed_kills_an_idle_non_folding_session() {
    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    assert!(app.manage(PtyManager::new()));
    let handle = app.handle().clone();
    let registry = app.state::<DetachRegistry>();
    registry
        .entries
        .insert("idle-session".to_string(), entry("term-idle", "Idle"));

    on_window_destroyed(&handle, "idle-session");

    assert!(
        !registry.entries.contains_key("idle-session"),
        "an idle, non-folding session should be forgotten rather than folded back"
    );
}

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
}
