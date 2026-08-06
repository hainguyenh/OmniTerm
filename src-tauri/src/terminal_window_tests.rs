//! Registry bookkeeping. The window-lifecycle half needs a real Tauri runtime and is covered by the
//! manual checks in the plan; what is unit-testable here is the part most likely to rot silently —
//! label minting and the calling-window lookup that stops one webview asking about another.

use super::*;
use crate::test_support;

pub(super) fn entry(label: &str, name: &str) -> DetachEntry {
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

    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "main",
        tauri::WebviewUrl::App("index.html".into())
    ).build().unwrap();

    on_window_destroyed(&handle, "idle-session");

    assert!(
        !registry.entries.contains_key("idle-session"),
        "an idle, non-folding session should be forgotten rather than folded back"
    );
}

#[test]
fn test_bootstrap_terminal_window() {
    use tauri::Manager;
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    let registry = app.state::<DetachRegistry>();
    registry.entries.insert("session-a".into(), entry("term-1", "One"));
    let window = tauri::WebviewWindowBuilder::new(&app, "term-1", tauri::WebviewUrl::App("index.html".into())).build().unwrap();
    let res = tauri::async_runtime::block_on(bootstrap_terminal_window(AsRef::<tauri::Webview<tauri::test::MockRuntime>>::as_ref(&window).window(), registry.clone())).unwrap();
    assert_eq!(res.unwrap().session_id, "session-a");

    let window2 = tauri::WebviewWindowBuilder::new(&app, "term-2", tauri::WebviewUrl::App("index.html".into())).build().unwrap();
    let res2 = tauri::async_runtime::block_on(bootstrap_terminal_window(AsRef::<tauri::Webview<tauri::test::MockRuntime>>::as_ref(&window2).window(), registry.clone())).unwrap();
    assert!(res2.is_none());
}

#[test]
fn test_release_terminal_window_present() {
    use tauri::Manager;
    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    let registry = app.state::<DetachRegistry>();
    registry.entries.insert("session-a".into(), entry("term-1", "One"));
    tauri::async_runtime::block_on(release_terminal_window(registry.clone(), "session-a".to_string())).unwrap();
    assert!(!registry.entries.contains_key("session-a"));
}

#[test]
fn test_focus_terminal_window_present() {
    use tauri::Manager;
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    let registry = app.state::<DetachRegistry>();
    registry.entries.insert("session-a".into(), entry("term-1", "One"));
    let window = tauri::WebviewWindowBuilder::new(&app, "term-1", tauri::WebviewUrl::App("index.html".into())).build().unwrap();
    tauri::async_runtime::block_on(focus_terminal_window(app.handle().clone(), registry.clone(), "session-a".to_string())).unwrap();
}

#[test]
fn test_reattach_terminal_present() {
    use tauri::Manager;
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    let registry = app.state::<DetachRegistry>();
    registry.entries.insert("session-a".into(), entry("term-1", "One"));
    let window = tauri::WebviewWindowBuilder::new(&app, "term-1", tauri::WebviewUrl::App("index.html".into())).build().unwrap();
    let res = tauri::async_runtime::block_on(reattach_terminal(app.handle().clone(), registry.clone(), "session-a".to_string())).unwrap();
    assert!(res);
}
