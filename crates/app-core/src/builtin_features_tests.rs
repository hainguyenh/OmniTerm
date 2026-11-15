use serde_json::json;

use super::*;

#[test]
fn every_feature_is_on_by_default_and_unreadable_state_counts_as_on() {
    for settings in [
        json!({}),
        json!({ SETTINGS_KEY: "nope" }),
        json!({ SETTINGS_KEY: [5, null] }),
    ] {
        assert!(is_enabled(&settings, AGENT_QUOTA));
        assert!(is_enabled(&settings, ALWAYS_AWAKE));
    }
}

#[test]
fn toggling_writes_a_sparse_sorted_list_of_the_features_that_are_off() {
    let off = enabled_patch(&json!({}), ALWAYS_AWAKE, false).expect("a built-in feature");
    assert_eq!(off, json!({ SETTINGS_KEY: [ALWAYS_AWAKE] }));
    assert!(!is_enabled(&off, ALWAYS_AWAKE));
    assert!(is_enabled(&off, AGENT_QUOTA));
    let both = enabled_patch(&off, AGENT_QUOTA, false).expect("a built-in feature");
    assert_eq!(both, json!({ SETTINGS_KEY: [AGENT_QUOTA, ALWAYS_AWAKE] }));
    let again = enabled_patch(&both, ALWAYS_AWAKE, true).expect("a built-in feature");
    assert_eq!(again, json!({ SETTINGS_KEY: [AGENT_QUOTA] }));
    // Unknown ids in the stored list are dropped rather than carried forward.
    let cleaned = enabled_patch(&json!({ SETTINGS_KEY: ["acme.x"] }), AGENT_QUOTA, true)
        .expect("a built-in feature");
    assert_eq!(cleaned, json!({ SETTINGS_KEY: [] }));
}

#[test]
fn ignores_ids_that_are_not_built_in_features() {
    assert_eq!(enabled_patch(&json!({}), "@omniterm/blur", false), None);
    assert!(find("omniterm.plugin-host").is_none());
}

#[test]
fn strips_the_feature_state_from_renderer_patches() {
    let mut patch = json!({ "themeId": "x", SETTINGS_KEY: [AGENT_QUOTA] });
    strip_patch(&mut patch);
    assert_eq!(patch, json!({ "themeId": "x" }));
    let mut not_an_object = json!(3);
    strip_patch(&mut not_an_object);
    assert_eq!(not_an_object, json!(3));
}

#[test]
fn describes_the_features_as_bundled_plugin_rows() {
    let rows = descriptors(&json!({ SETTINGS_KEY: [ALWAYS_AWAKE] }), "1.2.3");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["id"], AGENT_QUOTA);
    assert_eq!(
        (rows[0]["enabled"].clone(), rows[0]["status"].clone()),
        (json!(true), json!("loaded"))
    );
    assert_eq!(
        (rows[1]["enabled"].clone(), rows[1]["status"].clone()),
        (json!(false), json!("disabled"))
    );
    assert_eq!(
        (rows[1]["source"].clone(), rows[1]["version"].clone()),
        (json!("bundled"), json!("1.2.3"))
    );
}
