use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::json;

use super::super::deps::CliResult;
use super::super::fake_deps::{home, ok, FakeDeps};
use super::super::launcher::is_safe_prompt;
use super::*;

const HAIKU_ARGS: [&str; 9] = [
    "--tools",
    "",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "-p",
    "hi",
    "--model",
    "haiku",
];

fn wake(agent: AgentKind, dir: Option<&str>, launcher: Option<&str>, prompt: &str) -> WakeRequest {
    WakeRequest {
        agent,
        profile_dir: dir.map(PathBuf::from),
        launcher: launcher.map(str::to_string),
        prompt: prompt.to_string(),
    }
}

fn env_value(options: &super::super::deps::CliOptions, key: &str) -> Option<String> {
    options
        .env
        .get(std::ffi::OsStr::new(key))
        .map(|value| value.to_string_lossy().into_owned())
}

#[test]
fn wakes_claude_with_one_haiku_prompt_in_the_scratch_directory_for_the_profile() {
    let claude = home().join("claude.exe");
    let deps = FakeDeps::new(&[]).resolving(&claude);
    assert_eq!(
        wake_agent(
            &wake(AgentKind::Claude, Some(r"D:\p\work"), None, "hi"),
            &deps
        ),
        WakeResult {
            ok: true,
            message: None
        }
    );
    let (exe, args, options) = deps.run(0);
    assert_eq!(exe, claude);
    assert_eq!(args, HAIKU_ARGS);
    assert_eq!(
        env_value(&options, "CLAUDE_CONFIG_DIR").as_deref(),
        Some(r"D:\p\work")
    );
    assert_eq!(options.cwd, Some(deps.tmp.clone()));
}

#[test]
fn wakes_codex_read_only_with_its_profile_home() {
    let deps = FakeDeps::new(&[]).resolving("codex");
    wake_agent(
        &wake(AgentKind::Codex, Some(r"D:\c"), None, "hello there"),
        &deps,
    );
    let (_, args, options) = deps.run(0);
    assert_eq!(
        args,
        [
            "exec",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "hello there"
        ]
    );
    assert_eq!(env_value(&options, "CODEX_HOME").as_deref(), Some(r"D:\c"));
}

#[test]
fn wakes_through_the_profile_launcher_when_the_terminal_used_one() {
    let launcher = home().join(".local").join("bin").join("claude-th.cmd");
    let deps = FakeDeps::new(&[])
        .resolving("claude.exe")
        .with_launcher(&launcher)
        .with_env(&[("CLAUDE_CONFIG_DIR", "stale")]);
    wake_agent(
        &wake(AgentKind::Claude, None, Some("claude-th"), "hi"),
        &deps,
    );
    let (exe, args, options) = deps.run(0);
    assert_eq!(
        (exe, args),
        (launcher, HAIKU_ARGS.map(str::to_string).to_vec())
    );
    assert_eq!(env_value(&options, "CLAUDE_CONFIG_DIR"), None);
}

#[test]
fn refuses_unsafe_prompts_and_missing_clis() {
    let deps = FakeDeps::new(&[]);
    let unsafe_prompt = wake_agent(&wake(AgentKind::Claude, None, None, "hi & del *"), &deps);
    assert!(
        !unsafe_prompt.ok
            && unsafe_prompt
                .message
                .unwrap_or_default()
                .contains("letters")
    );
    for (agent, message) in [
        (AgentKind::Claude, "Claude Code CLI not found."),
        (AgentKind::Codex, "Codex CLI not found."),
        (AgentKind::Agy, "Antigravity CLI not found."),
    ] {
        assert_eq!(
            wake_agent(&wake(agent, None, None, "hi"), &deps),
            WakeResult::failed(message)
        );
    }
}

#[test]
fn reports_wake_timeouts_and_failures() {
    let run = |result: CliResult| {
        FakeDeps::new(&[])
            .resolving("claude.exe")
            .running(move |_| result.clone())
    };
    let request = wake(AgentKind::Claude, None, None, "hi");
    let timeout = run(CliResult {
        timed_out: true,
        ..CliResult::default()
    });
    assert_eq!(
        wake_agent(&request, &timeout),
        WakeResult::failed("The wake prompt timed out.")
    );
    let failed = run(CliResult {
        code: Some(1),
        stderr: "a\nrate limited".into(),
        ..CliResult::default()
    });
    assert_eq!(
        wake_agent(&request, &failed),
        WakeResult::failed("rate limited")
    );
    let silent = run(CliResult {
        code: Some(2),
        ..CliResult::default()
    });
    assert_eq!(
        wake_agent(&request, &silent),
        WakeResult::failed("The agent exited with code 2.")
    );
}

#[test]
fn accepts_only_plain_prompts() {
    assert!(is_safe_prompt("Xin chào, bạn khỏe không?"));
    let long = "x".repeat(121);
    for prompt in ["", "   ", "a\"b", "a%PATH%", long.as_str(), "a\nb", "a|b"] {
        assert!(!is_safe_prompt(prompt), "{prompt}");
    }
}

#[test]
fn accepts_well_formed_requests_and_normalises_empty_directories() {
    let request =
        parse_fetch_request(&json!({ "agent": "claude", "profileDir": "" })).expect("valid");
    assert_eq!(
        (request.agent, request.profile_dir, request.launcher),
        (AgentKind::Claude, None, None)
    );
    assert_eq!(
        parse_fetch_request(&json!({ "agent": "claude", "launcher": "claude-th" }))
            .expect("valid")
            .launcher
            .as_deref(),
        Some("claude-th")
    );
    assert_eq!(
        parse_fetch_request(&json!({ "agent": "agy", "launcher": "agy-work" }))
            .expect("valid")
            .launcher
            .as_deref(),
        Some("agy-work")
    );
    let family =
        parse_fetch_request(&json!({ "agent": "agy", "modelFamily": "claude" })).expect("valid");
    assert_eq!(
        (family.model_family, family.model_family_auto),
        (Some(ModelFamily::Claude), false)
    );
    assert!(
        parse_fetch_request(&json!({ "agent": "agy", "modelFamily": "auto" }))
            .expect("valid")
            .model_family_auto
    );
    assert_eq!(
        parse_wake_request(&json!({ "agent": "codex", "profileDir": r"D:\c", "prompt": "hi" }))
            .expect("valid"),
        wake(AgentKind::Codex, Some(r"D:\c"), None, "hi")
    );
}

#[test]
fn rejects_malformed_requests() {
    let fetch_error = |value: serde_json::Value| parse_fetch_request(&value).expect_err("invalid");
    assert_eq!(fetch_error(json!(null)), "Unknown agent");
    assert_eq!(fetch_error(json!({ "agent": "gpt" })), "Unknown agent");
    assert_eq!(
        fetch_error(json!({ "agent": "antigravity" })),
        "Unknown agent"
    );
    assert_eq!(
        fetch_error(json!({ "agent": "claude", "profileDir": 5 })),
        "Invalid profile directory"
    );
    assert_eq!(
        fetch_error(json!({ "agent": "claude", "profileDir": "a\u{0}b" })),
        "Invalid profile directory"
    );
    for launcher in [
        json!(r"C:\bin\claude-th.cmd"),
        json!("claude-th & calc"),
        json!("codex-x"),
        json!("claude"),
        json!(7),
    ] {
        assert_eq!(
            fetch_error(json!({ "agent": "claude", "launcher": launcher })),
            "Invalid profile launcher"
        );
    }
    let wake_error = |value: serde_json::Value| parse_wake_request(&value).expect_err("invalid");
    assert_eq!(
        wake_error(json!({ "agent": "claude", "launcher": "../claude-x", "prompt": "hi" })),
        "Invalid profile launcher"
    );
    assert_eq!(wake_error(json!({ "agent": "x" })), "Unknown agent");
    assert_eq!(wake_error(json!("claude")), "Unknown agent");
    assert_eq!(
        wake_error(json!({ "agent": "claude" })),
        "Missing wake prompt"
    );
}

#[test]
fn shares_one_in_flight_probe_per_profile_and_routes_by_agent() {
    let (release, gate) = mpsc::channel::<()>();
    let gate = Mutex::new(gate);
    let deps = FakeDeps::new(&[]).resolving("claude").running(move |_| {
        let _ = gate
            .lock()
            .expect("gate lock")
            .recv_timeout(Duration::from_secs(10));
        ok("Current session: 3% used")
    });
    let service = QuotaService::new(deps);
    let request = |dir: &str| {
        parse_fetch_request(&json!({ "agent": "claude", "profileDir": dir })).expect("valid")
    };
    let (first, second) = std::thread::scope(|scope| {
        let first = scope.spawn(|| service.fetch_usage(&request(r"D:\P")));
        while service.deps.run_count() == 0 {
            std::thread::sleep(Duration::from_millis(5));
        }
        let second = scope.spawn(|| service.fetch_usage(&request(r"d:\p")));
        std::thread::sleep(Duration::from_millis(150));
        release.send(()).expect("release the probe");
        (
            first.join().expect("first probe"),
            second.join().expect("second probe"),
        )
    });
    assert_eq!(first, second);
    assert_eq!(first.windows[0].used_pct, 3.0);
    assert_eq!(service.deps.run_count(), 1);
    let codex = parse_fetch_request(&json!({ "agent": "codex" })).expect("valid");
    assert_eq!(
        service.fetch_usage(&codex).error,
        Some(QuotaError::Unsupported)
    );
}

#[test]
fn turns_provider_errors_into_failed_snapshots_and_serves_profiles_and_the_scratch_dir() {
    let deps = FakeDeps::new(&[]).listing(|_| Err(std::io::Error::other("disk gone")));
    let service = QuotaService::new(deps);
    let codex = parse_fetch_request(&json!({ "agent": "codex" })).expect("valid");
    let snapshot = service.fetch_usage(&codex);
    assert_eq!(
        (snapshot.error, snapshot.message.as_deref()),
        (Some(QuotaError::Failed), Some("disk gone"))
    );
    assert!(service.list_profiles().is_empty());
    assert_eq!(service.probe_dir(), home().join("tmp"));
    let woken = QuotaService::new(FakeDeps::new(&[]).resolving("claude"));
    assert!(woken.wake(&wake(AgentKind::Claude, None, None, "hi")).ok);
}
