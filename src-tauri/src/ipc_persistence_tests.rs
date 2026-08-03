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
