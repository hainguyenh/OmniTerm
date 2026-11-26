use serde_json::json;
use tauri::async_runtime::block_on;

use super::*;

fn app() -> tauri::App<tauri::test::MockRuntime> {
    let app = crate::test_support::mock_app();
    crate::settings::write_settings_raw(app.handle(), crate::settings::defaults())
        .expect("reset the settings");
    app
}

#[test]
fn answers_while_the_feature_is_on_and_validates_requests_at_the_boundary() {
    let _guard = crate::test_support::lock();
    let app = app();
    let handle = app.handle().clone();
    assert!(block_on(agent_quota_info(handle.clone())));
    let rejected = block_on(agent_quota_fetch_usage(
        handle.clone(),
        json!({ "agent": "gpt" }),
    ));
    assert_eq!(rejected.expect_err("unknown agent"), "Unknown agent");
    let launcher = block_on(agent_quota_wake(
        handle.clone(),
        json!({ "agent": "claude", "launcher": "C:\\x\\claude-a.cmd", "prompt": "hi" }),
    ));
    assert_eq!(
        launcher.expect_err("a path is no launcher"),
        "Invalid profile launcher"
    );
    // Codex is read from its rollout logs, so an empty profile directory runs nothing.
    let empty = tempfile::tempdir().expect("temp dir");
    let request = json!({ "agent": "codex", "profileDir": empty.path().to_string_lossy() });
    let snapshot = block_on(agent_quota_fetch_usage(handle.clone(), request)).expect("a snapshot");
    assert_eq!(
        snapshot.error,
        Some(app_core::agent_quota::QuotaError::Unsupported)
    );
    let request = json!({ "agent": "codex", "profileDir": empty.path().to_string_lossy() });
    let passive = block_on(agent_quota_ensure_passive(handle.clone(), request));
    assert_eq!(
        passive,
        Ok(false),
        "no session log yet: the inline probe stays"
    );
    let claude = tempfile::tempdir().expect("temp dir");
    let request = json!({ "agent": "claude", "profileDir": claude.path().to_string_lossy() });
    let passive = block_on(agent_quota_ensure_passive(handle.clone(), request));
    assert_eq!(
        passive,
        Ok(true),
        "the bridge is installed into the profile"
    );
    assert!(claude.path().join("settings.json").exists());
    let scratch = block_on(agent_quota_probe_dir(handle)).expect("the scratch dir");
    assert!(scratch.ends_with("omniterm-wake"), "{scratch}");
}

#[test]
fn reads_only_the_bridge_record() {
    let _guard = crate::test_support::lock();
    let app = app();
    let handle = app.handle().clone();
    let profile = tempfile::tempdir().expect("temp profile");
    let request = || json!({ "agent": "claude", "profileDir": profile.path().to_string_lossy() });
    let none = block_on(agent_quota_bridge_reading(handle.clone(), request()));
    assert_eq!(none, Ok(None), "no record: nothing, and no CLI run");

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock after 1970")
        .as_millis() as i64;
    let record = json!({
        "version": 1,
        "writtenAt": now,
        "rateLimits": { "five_hour": { "used_percentage": 33.0, "resets_at": now / 1000 + 3600 } },
    });
    let dir = profile.path().join("omniterm");
    std::fs::create_dir_all(&dir).expect("bridge folder");
    std::fs::write(dir.join("claude-usage.json"), record.to_string()).expect("record");
    let reading = block_on(agent_quota_bridge_reading(handle.clone(), request()))
        .expect("read")
        .expect("the bridge record");
    assert_eq!(reading.fetched_at, now);
    assert_eq!(reading.windows[0].used_pct, 33.0);

    let rejected = block_on(agent_quota_bridge_reading(
        handle,
        json!({ "agent": "gpt" }),
    ));
    assert_eq!(rejected.expect_err("unknown agent"), "Unknown agent");
}

#[test]
fn refuses_to_run_anything_while_the_feature_is_off() {
    let _guard = crate::test_support::lock();
    let app = app();
    let handle = app.handle().clone();
    crate::builtin_features::set_enabled(&handle, AGENT_QUOTA, false).expect("switched off");
    assert!(!block_on(agent_quota_info(handle.clone())));
    let request = json!({ "agent": "codex" });
    assert!(block_on(agent_quota_fetch_usage(handle.clone(), request)).is_err());
    assert!(block_on(agent_quota_wake(
        handle.clone(),
        json!({ "agent": "claude", "prompt": "hi" })
    ))
    .is_err());
    assert!(block_on(agent_quota_list_profiles(handle.clone())).is_err());
    assert!(block_on(agent_quota_probe_dir(handle.clone())).is_err());
    let request = json!({ "agent": "claude" });
    assert!(block_on(agent_quota_ensure_passive(handle.clone(), request)).is_err());
    let request = json!({ "agent": "claude" });
    assert!(block_on(agent_quota_bridge_reading(handle.clone(), request)).is_err());
    crate::builtin_features::set_enabled(&handle, AGENT_QUOTA, true).expect("switched on");
}
