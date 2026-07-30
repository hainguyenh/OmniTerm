use super::{connection, IpcApp};
use serde_json::{json, Value};
use std::fs;

#[test]
fn ipc_persists_settings_themes_art_and_connections() {
    let fixture = IpcApp::new();

    let version = fixture.ok("get_version", json!({}));
    assert_eq!(version.as_str(), Some(env!("CARGO_PKG_VERSION")));

    let defaults = fixture.ok("get_settings", json!({}));
    assert!(defaults.is_object());
    let settings = json!({
        "theme": "dark",
        "fontSize": 17,
        "excludedViewableExts": ["pem"]
    });
    assert_eq!(
        fixture.ok("save_settings", json!({ "settings": settings })),
        Value::Null
    );
    assert_eq!(fixture.ok("get_settings", json!({}))["fontSize"], 17);
    let malformed = fixture.error("save_settings", json!({ "settings": "bad" }));
    assert!(malformed.to_string().to_lowercase().contains("settings"));

    assert!(fixture.ok("list_themes", json!({})).is_array());
    assert!(fixture
        .error("save_theme", json!({ "theme": { "name": "Missing id" } }))
        .to_string()
        .contains("id"));
    let theme = json!({ "id": "ipc-theme", "name": "IPC Theme", "colors": {} });
    assert_eq!(
        fixture.ok("save_theme", json!({ "theme": theme })),
        Value::Null
    );
    let themes = fixture.ok("list_themes", json!({}));
    assert!(themes
        .as_array()
        .is_some_and(|items| items.iter().any(|item| item["id"] == "ipc-theme")));
    assert_eq!(
        fixture.ok("delete_theme", json!({ "id": "ipc-theme" })),
        Value::Null
    );

    assert_eq!(fixture.ok("open_themes_folder", json!({})), Value::Null);

    assert!(fixture
        .error("get_custom_art", json!({ "slot": "unknown" }))
        .to_string()
        .contains("slot"));
    assert_eq!(
        fixture.ok("get_custom_art", json!({ "slot": "idle-light" })),
        Value::Null
    );
    assert_eq!(
        fixture.ok("remove_custom_art", json!({ "slot": "idle-light" })),
        Value::Null
    );

    let empty = fixture.ok("load_connections", json!({}));
    assert_eq!(empty, json!({ "connections": [], "folders": [] }));
    let tree = json!({ "connections": [connection("ipc-ssh")], "folders": [] });
    assert_eq!(
        fixture.ok("save_connections", json!({ "data": tree })),
        Value::Null
    );
    let saved = fixture.ok("load_connections", json!({}));
    assert_eq!(saved["connections"][0]["id"], "ipc-ssh");

    let invalid_tree = json!({
        "connections": [{
            "id": "unsafe",
            "name": "Unsafe type",
            "type": "TELNET"
        }],
        "folders": []
    });
    assert!(fixture
        .error("save_connections", json!({ "data": invalid_tree }))
        .to_string()
        .contains("invalid connection type"));
}

#[test]
fn ipc_uploads_and_removes_custom_art() {
    let fixture = IpcApp::new();
    let source = fixture.app_data_dir.join("source.png");
    fs::create_dir_all(source.parent().expect("source parent")).unwrap();
    fs::write(&source, b"not-a-real-png-but-a-bounded-test-file").unwrap();

    let stored = fixture.ok(
        "upload_custom_art",
        json!({ "slot": "loading-dark", "path": source }),
    );
    let stored_path = stored.as_str().expect("stored custom-art path");
    assert!(std::path::Path::new(stored_path).is_file());
    assert_eq!(
        fixture.ok("get_custom_art", json!({ "slot": "loading-dark" })),
        stored
    );
    assert_eq!(
        fixture.ok("remove_custom_art", json!({ "slot": "loading-dark" })),
        Value::Null
    );
    assert_eq!(
        fixture.ok("get_custom_art", json!({ "slot": "loading-dark" })),
        Value::Null
    );
}

#[test]
fn ipc_settings_recover_from_a_corrupt_file_and_preserve_defaults() {
    let fixture = IpcApp::new();
    fs::create_dir_all(&fixture.app_data_dir).unwrap();

    let settings_path = fixture.app_data_dir.join("settings.json");
    fs::write(&settings_path, b"{ definitely not json").unwrap();
    let fallback = fixture.ok("get_settings", json!({}));
    assert_eq!(fallback["fontSize"], 14);
    assert_eq!(fallback["themeId"], "tokyo-night");

    assert_eq!(
        fixture.ok(
            "save_settings",
            json!({ "settings": { "fontSize": 19, "smartColors": false } }),
        ),
        Value::Null
    );
    let repaired = fixture.ok("get_settings", json!({}));
    assert_eq!(repaired["fontSize"], 19);
    assert_eq!(repaired["smartColors"], false);
    assert_eq!(repaired["themeId"], "tokyo-night");
}

#[test]
fn ipc_connections_reject_corruption_then_round_trip_a_valid_tree() {
    let fixture = IpcApp::new();
    fs::create_dir_all(&fixture.app_data_dir).unwrap();

    let connections_path = fixture.app_data_dir.join("connections.json");
    fs::write(&connections_path, b"[not a connection tree]").unwrap();
    assert!(fixture.invoke("load_connections", json!({})).is_err());

    let repaired_tree = json!({
        "connections": [connection("recovered-ssh")],
        "folders": [{ "id": "ops", "name": "Ops", "parentId": null }]
    });
    assert_eq!(
        fixture.ok("save_connections", json!({ "data": repaired_tree })),
        Value::Null
    );
    let loaded = fixture.ok("load_connections", json!({}));
    assert_eq!(loaded["connections"][0]["id"], "recovered-ssh");
    assert_eq!(loaded["folders"][0]["id"], "ops");
}

#[test]
fn ipc_theme_listing_skips_invalid_entries_and_missing_deletes_are_safe() {
    let fixture = IpcApp::new();
    let themes = fixture.app_data_dir.join("themes");
    fs::create_dir_all(themes.join("directory.json")).unwrap();
    fs::write(themes.join("broken.json"), b"{ broken").unwrap();
    fs::write(themes.join("ignored.txt"), b"not a theme").unwrap();
    fs::write(
        themes.join("recovered.json"),
        br#"{"id":"recovered","name":"Recovered","colors":{}}"#,
    )
    .unwrap();

    let listed = fixture.ok("list_themes", json!({}));
    assert!(listed.as_array().is_some_and(|items| {
        items.iter().any(|theme| theme["id"] == "recovered")
            && items.iter().all(|theme| theme["id"] != "broken")
    }));
    assert_eq!(
        fixture.ok("delete_theme", json!({ "id": "missing-theme" })),
        Value::Null
    );
}
