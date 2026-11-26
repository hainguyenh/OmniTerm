use serde_json::json;
use tauri::Manager;

use super::*;
use crate::settings::defaults;

fn fresh_app() -> tauri::App<tauri::test::MockRuntime> {
    let app = crate::test_support::mock_app();
    app.manage(AlwaysAwakeState::new());
    write_settings_raw(app.handle(), defaults()).expect("reset the settings");
    app
}

#[test]
fn both_features_are_listed_and_on_by_default() {
    let _guard = crate::test_support::lock();
    let app = fresh_app();
    let rows = descriptors(app.handle());
    let ids: Vec<&str> = rows.iter().filter_map(|row| row["id"].as_str()).collect();
    assert_eq!(ids, [features::AGENT_QUOTA, features::ALWAYS_AWAKE]);
    assert!(rows
        .iter()
        .all(|row| row["enabled"] == json!(true) && row["source"] == json!("bundled")));
    assert!(is_enabled(app.handle(), features::AGENT_QUOTA));
}

#[test]
fn switching_a_feature_persists_it_and_stops_always_awake_at_once() {
    let _guard = crate::test_support::lock();
    let app = fresh_app();
    let row = set_enabled(app.handle(), features::ALWAYS_AWAKE, false)
        .expect("saved")
        .expect("a built-in feature");
    assert_eq!(
        (row["id"].clone(), row["enabled"].clone()),
        (json!(features::ALWAYS_AWAKE), json!(false))
    );
    assert!(!is_enabled(app.handle(), features::ALWAYS_AWAKE));
    assert!(is_enabled(app.handle(), features::AGENT_QUOTA));
    assert!(!app.state::<AlwaysAwakeState>().feature_enabled());
    set_enabled(app.handle(), features::ALWAYS_AWAKE, true).expect("saved");
    assert!(is_enabled(app.handle(), features::ALWAYS_AWAKE));
    assert!(app.state::<AlwaysAwakeState>().feature_enabled());
}

#[test]
fn leaves_node_plugin_ids_to_the_plugin_host() {
    let _guard = crate::test_support::lock();
    let app = fresh_app();
    assert_eq!(
        set_enabled(app.handle(), "acme.unknown", false).expect("no error"),
        None
    );
}

#[test]
fn switching_always_awake_without_its_native_state_still_persists_the_choice() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    write_settings_raw(app.handle(), defaults()).expect("reset the settings");
    assert!(app.try_state::<AlwaysAwakeState>().is_none());

    let row = set_enabled(app.handle(), features::ALWAYS_AWAKE, false)
        .expect("saved")
        .expect("a built-in feature row");
    assert_eq!(row["enabled"], json!(false));
    assert!(!is_enabled(app.handle(), features::ALWAYS_AWAKE));
    set_enabled(app.handle(), features::ALWAYS_AWAKE, true).expect("restored");
}
