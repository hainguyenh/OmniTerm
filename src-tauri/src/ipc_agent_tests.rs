//! End-to-end IPC contract tests for the agent pane commands: session lookup, transcript export,
//! the crash-safe session store, session-file cleanup and the Agent Quota usage commands.

use super::IpcApp;
use serde_json::{json, Value};
use std::fs;

const SESSION_UUID: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";

#[test]
fn ipc_resolves_claude_sessions_only_from_uuid_files_in_the_profile() {
    let fixture = IpcApp::new();
    let profile = tempfile::tempdir().expect("profile dir");
    let cwd = "/work/project";
    let project = profile.path().join("projects").join("-work-project");
    fs::create_dir_all(&project).expect("project dir");
    fs::write(project.join(format!("{SESSION_UUID}.jsonl")), "{}\n").expect("session file");
    fs::write(project.join("not-a-uuid.jsonl"), "{}\n").expect("decoy file");
    let profile_dir = profile.path().to_string_lossy().into_owned();

    let found = fixture.ok(
        "resolve_claude_session",
        json!({ "profileDir": profile_dir, "cwd": format!("{cwd}/"), "sinceEpochSecs": null }),
    );
    assert_eq!(found, SESSION_UUID);

    // A file that predates the agent process is never offered for resume.
    let stale = fixture.ok(
        "resolve_claude_session",
        json!({ "profileDir": profile_dir, "cwd": cwd, "sinceEpochSecs": u64::MAX / 2 }),
    );
    assert_eq!(stale, Value::Null);

    let blank = fixture.ok(
        "resolve_claude_session",
        json!({ "profileDir": " ", "cwd": cwd }),
    );
    assert_eq!(blank, Value::Null);
}

#[test]
fn ipc_transcript_export_rejects_anything_but_a_bare_uuid_in_a_profile() {
    let fixture = IpcApp::new();
    let profile = tempfile::tempdir().expect("profile dir");
    let profile_dir = profile.path().to_string_lossy().into_owned();

    for (dir, id) in [
        (profile_dir.as_str(), "../../etc/passwd"),
        ("", SESSION_UUID),
    ] {
        assert_eq!(
            fixture.error(
                "export_claude_transcript",
                json!({ "profileDir": dir, "sessionId": id }),
            ),
            "Invalid Claude session."
        );
    }

    let missing = fixture.error(
        "export_claude_transcript",
        json!({ "profileDir": profile_dir, "sessionId": SESSION_UUID }),
    );
    assert!(missing
        .as_str()
        .expect("error text")
        .starts_with("Transcript export failed:"));
}

#[test]
fn ipc_session_store_round_trips_objects_and_refuses_other_documents() {
    let fixture = IpcApp::new();

    assert_eq!(fixture.ok("agent_sessions_load", json!({})), Value::Null);

    let document = json!({ "version": 1, "sessions": [{ "id": "a" }] });
    assert_eq!(
        fixture.ok("agent_sessions_save", json!({ "document": document })),
        Value::Null
    );
    assert!(fixture.app_data_dir.join("agent-sessions.json").is_file());
    assert_eq!(fixture.ok("agent_sessions_load", json!({})), document);

    let refused = fixture.error("agent_sessions_save", json!({ "document": [1, 2] }));
    assert!(refused
        .as_str()
        .expect("error text")
        .starts_with("Session store write failed:"));
    assert_eq!(fixture.ok("agent_sessions_load", json!({})), document);
}

#[test]
fn ipc_resolves_the_agent_model_from_the_profile_settings() {
    let fixture = IpcApp::new();
    let profile = tempfile::tempdir().expect("profile dir");
    fs::write(
        profile.path().join("settings.json"),
        r#"{ "model": "opus" }"#,
    )
    .expect("settings file");
    let profile_dir = profile.path().to_string_lossy().into_owned();

    let model = fixture.ok(
        "resolve_agent_model",
        json!({ "agent": "Claude", "profileDir": profile_dir, "cwd": null }),
    );
    assert_eq!(model["model"], "Claude Opus");

    let unknown = fixture.ok(
        "resolve_agent_model",
        json!({ "agent": "unknown-agent", "profileDir": profile_dir }),
    );
    assert_eq!(unknown, Value::Null);
}

#[test]
fn ipc_session_cleanup_refuses_oversized_requests_before_touching_the_disk() {
    let fixture = IpcApp::new();

    // Listing and deleting walk the user's real agent folders, so only the request validation runs
    // here; `app_core::agent_session_index` covers the walk against temporary roots.
    let too_long = "x".repeat(257);
    assert_eq!(
        fixture.error("agent_session_files_delete", json!({ "ids": [too_long] })),
        "Invalid session list."
    );
    let too_many = vec!["id"; app_core::agent_session_index::MAX_SESSIONS + 1];
    assert_eq!(
        fixture.error("agent_session_files_delete", json!({ "ids": too_many })),
        "Invalid session list."
    );
}

#[test]
fn ipc_agent_quota_usage_commands_follow_the_feature_switch() {
    let fixture = IpcApp::new();

    assert_eq!(fixture.ok("agent_quota_info", json!({})), true);
    assert_eq!(
        fixture.error(
            "agent_quota_fetch_usage",
            json!({ "request": { "agent": "gpt" } })
        ),
        "Unknown agent"
    );
    assert_eq!(
        fixture.error(
            "agent_quota_wake",
            json!({ "request": { "agent": "claude", "launcher": "C:\\x\\claude-a.cmd", "prompt": "hi" } }),
        ),
        "Invalid profile launcher"
    );
    let empty = tempfile::tempdir().expect("empty codex profile");
    let snapshot = fixture.ok(
        "agent_quota_fetch_usage",
        json!({ "request": { "agent": "codex", "profileDir": empty.path().to_string_lossy() } }),
    );
    assert!(
        snapshot.get("error").is_some_and(|error| !error.is_null()),
        "{snapshot}"
    );
    assert!(fixture
        .ok("agent_quota_list_profiles", json!({}))
        .is_array());
    let probe = fixture.ok("agent_quota_probe_dir", json!({}));
    assert!(probe
        .as_str()
        .expect("probe dir")
        .ends_with("omniterm-wake"));

    let handle = fixture.handle();
    crate::builtin_features::set_enabled(&handle, app_core::builtin_features::AGENT_QUOTA, false)
        .expect("switch Agent Quota off");
    assert_eq!(fixture.ok("agent_quota_info", json!({})), false);
    let off = "Agent Quota is turned off in Plugins.";
    assert_eq!(fixture.error("agent_quota_list_profiles", json!({})), off);
    assert_eq!(fixture.error("agent_quota_probe_dir", json!({})), off);
    assert_eq!(
        fixture.error(
            "agent_quota_wake",
            json!({ "request": { "agent": "claude" } })
        ),
        off
    );
    assert_eq!(
        fixture.error(
            "agent_quota_fetch_usage",
            json!({ "request": { "agent": "codex" } })
        ),
        off
    );
}
