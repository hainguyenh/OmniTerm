//! The update coordinator's window readiness, poisoned-lock degradation and check announcements.
//! Announcement tests drive the real updater plugin against a loopback HTTP endpoint.

use super::*;
use crate::ide::events::IDE_EVENT;
use crate::test_support::{lock, mock_app};
use crate::update_manager::UpdaterRegistered;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;
use tauri::test::MockRuntime;
use tauri::Listener;

/// Serves `bodies` in order, one HTTP response per connection, and returns the endpoint URL.
fn serve(bodies: Vec<&'static str>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind a loopback port");
    let url = format!(
        "http://{}/latest.json",
        listener.local_addr().expect("listener address")
    );
    std::thread::spawn(move || {
        for body in bodies {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                match stream.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => request.extend_from_slice(&buffer[..read]),
                }
            }
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });
    url
}

/// A mock app whose updater plugin is registered and points only at `endpoint`.
fn updater_app(endpoint: &str) -> tauri::App<MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().identifier = crate::test_support::test_identifier();
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": "test-key",
            "endpoints": [endpoint],
            "dangerousInsecureTransportProtocol": true,
        }),
    );
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(UpdaterRegistered(true))
        .manage(UpdatesCoordinator::default())
        .build(context)
        .expect("build a mock app with the updater plugin");
    crate::test_support::sweep_ended_runs(app.handle());
    app
}

fn ide_events(app: &tauri::App<MockRuntime>) -> Receiver<String> {
    let (sender, receiver) = channel();
    app.handle().listen(IDE_EVENT, move |event| {
        let _ = sender.send(event.payload().to_string());
    });
    receiver
}

fn drain(receiver: &Receiver<String>) -> Vec<String> {
    receiver.try_iter().collect()
}

fn poison<T>(mutex: &Mutex<T>) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let _guard = mutex.lock().expect("not yet poisoned");
        panic!("poison the coordinator lock for the test");
    }));
    assert!(mutex.is_poisoned());
}

const RELEASE: &str = r#"{"version":"999.0.0","notes":"Fixes","url":"https://example.invalid/app.zip","signature":"sig"}"#;
/// Parses, but lists no platform this build could install: the check fails after the request.
const NO_TARGET: &str = r#"{"version":"999.0.0","platforms":{}}"#;

#[test]
fn window_readiness_is_tracked_and_an_unconfigured_updater_never_starts_polling() {
    let app = mock_app();
    let coord = UpdatesCoordinator::default();

    coord.window_ready(app.handle(), "main", true, "fr-FR".into());
    coord.window_ready(app.handle(), "term-1", true, "de-DE".into());
    assert_eq!(coord.system_locale(), "de-DE");
    assert!(coord.ready.lock().expect("ready set").contains("main"));

    coord.window_ready(app.handle(), "main", false, "ignored".into());
    let ready = coord.ready.lock().expect("ready set").clone();
    assert_eq!(ready, HashSet::from(["term-1".to_string()]));
    assert_eq!(
        coord.system_locale(),
        "de-DE",
        "a closing window keeps the locale"
    );
    assert!(!coord.started.load(Ordering::SeqCst));
}

#[test]
fn poisoned_locks_degrade_to_defaults_instead_of_panicking() {
    let _guard = lock();
    let app = mock_app();
    let events = ide_events(&app);
    let coord = UpdatesCoordinator::default();
    poison(&coord.ready);
    poison(&coord.system_locale);
    poison(&coord.state);

    coord.window_ready(app.handle(), "main", true, "fr-FR".into());
    coord.window_ready(app.handle(), "main", false, "fr-FR".into());
    assert_eq!(coord.system_locale(), "");

    tauri::async_runtime::block_on(coord.check_once(app.handle()));
    coord.emit_status(app.handle());
    assert!(
        drain(&events).is_empty(),
        "no status can be read from a poisoned state"
    );
}

#[test]
fn a_new_version_is_announced_once_and_a_failed_check_keeps_the_last_success() {
    let _guard = lock();
    let app = updater_app(&serve(vec![RELEASE, RELEASE, NO_TARGET]));
    let events = ide_events(&app);
    let coord = app.state::<UpdatesCoordinator>();

    tauri::async_runtime::block_on(coord.check_once(app.handle()));
    let first = drain(&events);
    assert_eq!(
        first
            .iter()
            .filter(|e| e.contains("updateAvailable"))
            .count(),
        1,
        "{first:?}"
    );
    assert!(first.iter().any(|e| e.contains("999.0.0")));
    let checked_at = coord
        .state
        .lock()
        .expect("state")
        .policy
        .status
        .last_checked;
    assert!(checked_at.is_some());

    // The same version again is a successful check but not a second announcement.
    tauri::async_runtime::block_on(coord.check_once(app.handle()));
    let second = drain(&events);
    assert!(
        !second.iter().any(|e| e.contains("updateAvailable")),
        "{second:?}"
    );
    assert_eq!(second.len(), 2, "only the two status changes: {second:?}");

    tauri::async_runtime::block_on(coord.check_once(app.handle()));
    let third = drain(&events);
    assert!(!third.iter().any(|e| e.contains("updateAvailable")));
    let state = coord.state.lock().expect("state");
    assert!(!state.policy.status.checking);
    assert!(state.policy.status.last_checked >= checked_at);
}

#[test]
fn the_first_ready_window_starts_one_poller_that_checks_immediately() {
    let _guard = lock();
    let app = updater_app(&serve(vec![RELEASE]));
    let events = ide_events(&app);
    let coord = app.state::<UpdatesCoordinator>();

    coord.window_ready(app.handle(), "main", true, "en-US".into());
    coord.window_ready(app.handle(), "term-1", true, "en-US".into());
    assert!(coord.started.load(Ordering::SeqCst));

    let mut announced = false;
    for _ in 0..100 {
        if let Ok(payload) = events.recv_timeout(Duration::from_millis(100)) {
            announced |= payload.contains("updateAvailable");
        }
        let done = coord
            .state
            .lock()
            .map(|state| state.policy.status.last_checked.is_some())
            .unwrap_or(false);
        if announced && done {
            break;
        }
    }
    assert!(announced, "the poller's first check announces the release");
    // Once checked, the next check is hours away; a wake re-evaluates the delay and sleeps again.
    coord.wake.notify_one();
    std::thread::sleep(Duration::from_millis(50));
    assert!(drain(&events)
        .iter()
        .all(|e| !e.contains("updateAvailable")));
}
