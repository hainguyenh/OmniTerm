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
