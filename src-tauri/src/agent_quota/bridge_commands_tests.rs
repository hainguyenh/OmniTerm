use tauri::async_runtime::block_on;

use super::*;

fn app() -> tauri::App<tauri::test::MockRuntime> {
    let app = crate::test_support::mock_app();
    crate::settings::write_settings_raw(app.handle(), crate::settings::defaults())
        .expect("reset the settings");
    app
}

#[test]
fn installs_reports_and_removes_the_bridge_in_a_profile() {
    let _guard = crate::test_support::lock();
    let app = app();
    let handle = app.handle().clone();
    let profile = tempfile::tempdir().expect("temp profile");
    let dir = profile.path().to_string_lossy().into_owned();

    let before = block_on(agent_quota_claude_bridge_status(
        handle.clone(),
        dir.clone(),
    ))
    .expect("status");
    assert!(!before.installed);

    let installed = block_on(agent_quota_claude_bridge_install(
        handle.clone(),
        dir.clone(),
    ))
    .expect("install");
    assert!(installed.installed && installed.current, "{installed:?}");
    let bridge = std::fs::read_to_string(profile.path().join("omniterm").join("bridge.json"))
        .expect("bridge.json");
    assert!(
        bridge.contains("settings.json"),
        "the guard learns where the limits are"
    );

    let removed = block_on(agent_quota_claude_bridge_remove(handle.clone(), dir)).expect("remove");
    assert!(!removed.installed);
}

#[test]
fn installs_and_removes_the_antigravity_bridge_in_its_cli_folder() {
    let _guard = crate::test_support::lock();
    let app = app();
    let handle = app.handle().clone();
    let home = tempfile::tempdir().expect("temp home");
    let dir = home.path().to_string_lossy().into_owned();
    let installed =
        block_on(agent_quota_agy_bridge_install(handle.clone(), dir.clone())).expect("install");
    assert!(installed.installed && installed.current, "{installed:?}");
    assert!(home
        .path()
        .join("antigravity-cli")
        .join("settings.json")
        .exists());
    let status =
        block_on(agent_quota_agy_bridge_status(handle.clone(), dir.clone())).expect("status");
    assert!(status.current);
    let removed = block_on(agent_quota_agy_bridge_remove(handle, dir)).expect("remove");
    assert!(!removed.installed);
}

#[test]
fn reads_a_conversations_status_line_and_nothing_once_the_feature_is_off() {
    let _guard = crate::test_support::lock();
    let app = app();
    let handle = app.handle().clone();
    let profile = tempfile::tempdir().expect("temp profile");
    let dir = profile.path().to_string_lossy().into_owned();
    let session = "11111111-1111-4111-8111-111111111111".to_string();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after 1970")
        .as_millis();
    let record = serde_json::json!({
        "version": 1,
        "writtenAt": now as i64,
        "text": "Opus · 5h 4%",
        "contextPct": 12.5,
    });
    let file = profile.path().join("omniterm").join("statuslines");
    std::fs::create_dir_all(&file).expect("statuslines folder");
    std::fs::write(file.join(format!("{session}.json")), record.to_string()).expect("record");

    let text = block_on(agent_quota_statusline_text(
        handle.clone(),
        dir.clone(),
        session.clone(),
    ));
    let read = text.expect("read").expect("a status line");
    assert_eq!(read.text, "Opus · 5h 4%");
    assert_eq!(read.context_pct, Some(12.5));
    let other = block_on(agent_quota_statusline_text(
        handle.clone(),
        dir.clone(),
        "../x".to_string(),
    ));
    assert_eq!(other.expect("read"), None);
    let relative = block_on(agent_quota_statusline_text(
        handle.clone(),
        "relative".to_string(),
        session.clone(),
    ));
    assert_eq!(relative.expect_err("relative"), "Invalid profile folder");

    let mut settings = crate::settings::defaults();
    settings["disabledBuiltinFeatures"] = serde_json::json!([AGENT_QUOTA]);
    crate::settings::write_settings_raw(&handle, settings).expect("disable the feature");
    let off = block_on(agent_quota_statusline_text(handle, dir, session));
    assert_eq!(off.expect("off"), None);
}

#[test]
fn refuses_relative_folders_and_a_disabled_feature() {
    let _guard = crate::test_support::lock();
    let app = app();
    let handle = app.handle().clone();
    let relative = block_on(agent_quota_claude_bridge_install(
        handle.clone(),
        "relative".to_string(),
    ));
    assert_eq!(relative.expect_err("relative"), "Invalid profile folder");

    let mut settings = crate::settings::defaults();
    settings["disabledBuiltinFeatures"] = serde_json::json!([AGENT_QUOTA]);
    crate::settings::write_settings_raw(&handle, settings).expect("disable the feature");
    let off = block_on(agent_quota_claude_bridge_status(handle, "C:/x".to_string()));
    assert_eq!(
        off.expect_err("disabled"),
        "Agent Quota is turned off in Plugins."
    );
}
