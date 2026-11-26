//! Context reports from a detached window, and how a destroyed window's busy or idle session is
//! handled when the PTY manager tracks it. Driven through real mock windows.

use super::tests::entry;
use super::*;
use crate::pty::PtySessionMeta;
use crate::test_support;
use session_protocol::{PersistencePolicy, SessionLifecycle};
use std::sync::mpsc::{channel, Receiver};
use tauri::test::MockRuntime;
use tauri::Listener;

const SESSION: &str = "session-ctx";
const LABEL: &str = "term-ctx";

fn window(app: &tauri::App<MockRuntime>, label: &str) -> tauri::WebviewWindow<MockRuntime> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .build()
        .expect("build a mock window")
}

fn listen(app: &tauri::App<MockRuntime>, event: &str) -> Receiver<Value> {
    let (sender, receiver) = channel();
    app.listen_any(event, move |event| {
        let payload = serde_json::from_str(event.payload()).expect("JSON event payload");
        let _ = sender.send(payload);
    });
    receiver
}

fn report(
    app: &tauri::App<MockRuntime>,
    from: &tauri::WebviewWindow<MockRuntime>,
    session: &str,
    cwd: Option<&str>,
    title: Option<&str>,
) -> Result<(), String> {
    tauri::async_runtime::block_on(report_detached_terminal_context(
        from.as_ref().window(),
        app.state::<DetachRegistry>(),
        session.to_string(),
        cwd.map(str::to_string),
        title.map(str::to_string),
    ))
}

fn meta(busy: bool) -> PtySessionMeta {
    PtySessionMeta {
        pid: None,
        launched_with_command: false,
        ssh: false,
        busy,
        generation: 1,
        policy: PersistencePolicy::CloseWithApp,
        lifecycle: SessionLifecycle::Live,
        label: "Context shell".to_string(),
    }
}

#[test]
fn context_reports_are_trimmed_deduplicated_and_forwarded_per_changed_field() {
    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    let detached = window(&app, LABEL);
    app.state::<DetachRegistry>()
        .entries
        .insert(SESSION.to_string(), entry(LABEL, "Context"));
    let events = listen(&app, CONTEXT_EVENT);

    // No main window yet: the change is still recorded, there is just nobody to tell.
    report(&app, &detached, SESSION, Some(" /work "), Some(" build ")).expect("first report");
    {
        let registry = app.state::<DetachRegistry>();
        let stored = registry.entries.get(SESSION).expect("entry");
        assert_eq!(stored.last_cwd.as_deref(), Some("/work"));
        assert_eq!(stored.last_title.as_deref(), Some("build"));
    }

    let _main = window(&app, MAIN_WINDOW);
    report(&app, &detached, SESSION, Some("/work"), Some("build")).expect("unchanged report");
    assert!(
        events.try_recv().is_err(),
        "an unchanged report emits nothing"
    );

    report(&app, &detached, SESSION, Some("/work"), Some("test")).expect("title change");
    let payload = events.try_recv().expect("title change forwarded");
    assert_eq!(payload["sessionId"], SESSION);
    assert_eq!(payload["cwd"], Value::Null);
    assert_eq!(payload["title"], "test");

    report(&app, &detached, SESSION, Some("/work/sub"), Some("test")).expect("cwd change");
    let payload = events.try_recv().expect("cwd change forwarded");
    assert_eq!(payload["cwd"], "/work/sub");
    assert_eq!(payload["title"], Value::Null);

    // Blank values clear what was stored rather than being reported as empty strings.
    report(&app, &detached, SESSION, Some("  "), None).expect("cleared");
    let payload = events.try_recv().expect("clearing forwarded");
    assert_eq!(payload["cwd"], Value::Null);
    let registry = app.state::<DetachRegistry>();
    let stored = registry.entries.get(SESSION).expect("entry");
    assert_eq!(stored.last_cwd, None);
    assert_eq!(stored.last_title, None);
}

#[test]
fn a_window_cannot_report_context_for_a_session_it_does_not_own() {
    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    let detached = window(&app, LABEL);
    app.state::<DetachRegistry>()
        .entries
        .insert(SESSION.to_string(), entry(LABEL, "Context"));

    let error = report(&app, &detached, "someone-else", Some("/x"), None)
        .expect_err("a foreign session is refused");
    assert_eq!(error, "Detached window does not own this terminal session");
}

#[test]
fn closing_the_window_of_a_busy_session_folds_it_back_instead_of_killing_it() {
    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    assert!(app.manage(PtyManager::new()));
    let _main = window(&app, MAIN_WINDOW);
    let reattached = listen(&app, REATTACHED_EVENT);
    app.state::<DetachRegistry>()
        .entries
        .insert(SESSION.to_string(), entry(LABEL, "Busy"));
    app.state::<PtyManager>()
        .sessions
        .insert(SESSION.to_string(), meta(true));

    on_window_destroyed(app.handle(), SESSION);

    assert_eq!(reattached.try_recv().expect("fold-back event"), SESSION);
    assert!(!app.state::<DetachRegistry>().entries.contains_key(SESSION));
    assert!(
        app.state::<PtyManager>().sessions.contains_key(SESSION),
        "running work survives the closed window"
    );
}

#[test]
fn closing_the_window_of_an_idle_session_kills_it_and_tells_the_main_window() {
    let app = test_support::mock_app();
    assert!(app.manage(DetachRegistry::new()));
    assert!(app.manage(PtyManager::new()));
    let _main = window(&app, MAIN_WINDOW);
    let closed = listen(&app, CLOSED_EVENT);
    app.state::<DetachRegistry>()
        .entries
        .insert(SESSION.to_string(), entry(LABEL, "Idle"));
    app.state::<PtyManager>()
        .sessions
        .insert(SESSION.to_string(), meta(false));

    on_window_destroyed(app.handle(), SESSION);

    assert_eq!(closed.try_recv().expect("closed event"), SESSION);
    assert!(!app.state::<DetachRegistry>().entries.contains_key(SESSION));
    assert!(!app.state::<PtyManager>().sessions.contains_key(SESSION));
}
