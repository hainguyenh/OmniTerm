//! The in-flight sharing, crash handling and request edges of the quota service.

use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::json;

use super::super::deps::CliResult;
use super::super::fake_deps::{now, FakeDeps};
use super::*;

fn wake(agent: AgentKind, prompt: &str) -> WakeRequest {
    WakeRequest {
        agent,
        profile_dir: None,
        launcher: None,
        prompt: prompt.to_string(),
    }
}

#[test]
fn turns_a_crashed_probe_into_a_failure_carrying_its_message() {
    let flight = InFlight::<String>::new();
    let crashed = |message: String| format!("crashed: {message}");
    assert_eq!(
        flight.run("k".into(), || panic!("static text"), crashed),
        "crashed: static text"
    );
    assert_eq!(
        flight.run("k".into(), || panic!("formatted {}", 7), crashed),
        "crashed: formatted 7"
    );
    assert_eq!(
        flight.run("k".into(), || std::panic::panic_any(42_u8), crashed),
        "crashed: The quota probe failed."
    );
    // The crashed probe left no slot behind, so the next call runs its own work.
    assert_eq!(
        flight.run("k".into(), || "fresh".to_string(), crashed),
        "fresh"
    );
}

#[test]
fn reports_a_provider_that_panics_as_a_failed_snapshot_and_wake() {
    let service = QuotaService::new(
        FakeDeps::new(&[])
            .resolving("claude")
            .running(|_| panic!("probe exploded")),
    );
    let request = parse_fetch_request(&json!({ "agent": "claude" })).expect("valid");
    assert_eq!(
        service.fetch_usage(&request),
        QuotaSnapshot::failure(now(), QuotaError::Failed, "probe exploded")
    );
    assert_eq!(
        service.wake(&wake(AgentKind::Claude, "hi")),
        WakeResult::failed("probe exploded")
    );
}

#[test]
fn a_second_wake_of_the_same_profile_shares_the_first_ones_result() {
    let (release, gate) = mpsc::channel::<()>();
    let gate = Mutex::new(gate);
    let service = QuotaService::new(FakeDeps::new(&[]).resolving("claude").running(move |_| {
        let _ = gate
            .lock()
            .expect("gate lock")
            .recv_timeout(Duration::from_secs(10));
        CliResult {
            code: Some(1),
            stderr: "first answer".into(),
            ..CliResult::default()
        }
    }));
    let request = wake(AgentKind::Claude, "hi");
    let key = profile_key(AgentKind::Claude, None, "", None);
    let holders = || {
        service
            .waking
            .slots
            .lock()
            .expect("slots lock")
            .get(&key)
            .map_or(0, Arc::strong_count)
    };
    let (first, second) = std::thread::scope(|scope| {
        let first = scope.spawn(|| service.wake(&request));
        while service.deps.run_count() == 0 {
            std::thread::sleep(Duration::from_millis(5));
        }
        let second = scope.spawn(|| service.wake(&request));
        // The map, the leader and the waiting follower each hold the slot.
        while holders() < 3 {
            std::thread::sleep(Duration::from_millis(5));
        }
        release.send(()).expect("release the wake");
        (
            first.join().expect("first wake"),
            second.join().expect("second wake"),
        )
    });
    assert_eq!(first, WakeResult::failed("first answer"));
    assert_eq!(second, first);
    assert_eq!(service.deps.run_count(), 1);
}

#[test]
fn routes_agy_fetches_by_model_family() {
    let service = QuotaService::new(FakeDeps::new(&[]));
    for family in [json!("gemini"), json!("claude"), json!("auto"), json!(null)] {
        let request =
            parse_fetch_request(&json!({ "agent": "agy", "modelFamily": family })).expect("valid");
        let snapshot = service.fetch_usage(&request);
        assert_eq!(
            (snapshot.error, snapshot.message.as_deref()),
            (
                Some(QuotaError::Unsupported),
                Some("Antigravity CLI not found.")
            ),
            "{family}"
        );
    }
}

#[test]
fn wakes_agy_in_print_mode_and_reports_a_silent_crash() {
    let deps = FakeDeps::new(&[])
        .resolving("agy")
        .running(|_| CliResult::default());
    assert_eq!(
        wake_agent(&wake(AgentKind::Agy, "hi"), &deps),
        WakeResult::failed("The agent exited with code null.")
    );
    let (exe, args, _) = deps.run(0);
    assert_eq!(
        (exe, args),
        (
            PathBuf::from("agy"),
            vec![
                "-p".to_string(),
                "hi".to_string(),
                "--disable-slash-commands".to_string()
            ]
        )
    );
}

#[test]
fn normalises_an_empty_launcher_and_refuses_an_overlong_directory() {
    let request = parse_wake_request(&json!({ "agent": "claude", "launcher": "", "prompt": "hi" }))
        .expect("valid");
    assert_eq!(request.launcher, None);
    let long = "d".repeat(1025);
    assert_eq!(
        parse_fetch_request(&json!({ "agent": "claude", "profileDir": long })),
        Err("Invalid profile directory".to_string())
    );
    let longest = "d".repeat(1024);
    assert_eq!(
        parse_fetch_request(&json!({ "agent": "claude", "profileDir": longest }))
            .expect("valid")
            .profile_dir,
        Some(PathBuf::from("d".repeat(1024)))
    );
}

#[test]
fn refuses_a_wake_request_for_an_invalid_profile_directory() {
    assert_eq!(
        parse_wake_request(&json!({ "agent": "claude", "profileDir": 3, "prompt": "hi" })),
        Err("Invalid profile directory".to_string())
    );
}
