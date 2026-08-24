//! Settings transfer tests: envelope export across the four stores, versioned import with
//! merge-or-replace, and the hard rule that no secret can survive an export/import round trip.
//!
//! Test-only exception: the global fixture lock (`test_support::lock`) guards process-shared mock
//! app directories, so it must be held across the awaited command calls below. There is no real
//! contention — `#[tokio::test]` runs each test body on its own single-threaded runtime.
#![allow(clippy::await_holding_lock)]

use super::{export_settings, import_settings};
use crate::connections;
use crate::settings;
use crate::test_support::mock_app;
use serde_json::{json, Value};
fn sections(envelope: &Value) -> &Value {
    envelope.get("sections").expect("envelope has sections")
}

fn seed_connection_tree(app: &tauri::App<tauri::test::MockRuntime>) {
    let tree = json!({
        "folders": [{ "id": "fold-1", "name": "Servers" }],
        "connections": [
            { "id": "c1", "name": "Box", "type": "SSH", "host": "h", "port": "22", "user": "me", "parentId": "fold-1" },
            { "id": "c2", "name": "Local", "type": "LOCAL" }
        ]
    });
    let path = connections::connections_path(app.handle()).expect("connections path");
    std::fs::write(path, serde_json::to_string(&tree).expect("serialize"))
        .expect("seed connections");
}

#[tokio::test]
async fn export_produces_a_versioned_envelope_with_all_four_sections() {
    let _guard = crate::test_support::lock();
    let app = mock_app();
    seed_connection_tree(&app);

    let envelope = export_settings(app.handle().clone()).await.expect("export");

    assert_eq!(envelope["version"], 1);
    assert!(envelope["exportedAt"]
        .as_str()
        .is_some_and(|t| !t.is_empty()));
    let sections = sections(&envelope);
    for key in ["appSettings", "connections", "themes", "workspaces"] {
        assert!(sections.get(key).is_some(), "missing section {key}");
    }
    assert_eq!(
        sections["connections"]["connections"]
            .as_array()
            .expect("list")
            .len(),
        2
    );
}

#[tokio::test]
async fn exported_connections_cannot_carry_secret_keys_even_if_one_lands_on_disk() {
    let _guard = crate::test_support::lock();
    let app = mock_app();
    let tree = json!({
        "folders": [],
        "connections": [
            { "id": "c1", "name": "Legacy", "type": "SSH", "host": "h", "port": "22", "user": "me",
              "password": "hunter2", "hasPassword": true }
        ]
    });
    let path = connections::connections_path(app.handle()).expect("connections path");
    std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    std::fs::write(&path, serde_json::to_string(&tree).expect("serialize")).expect("seed");

    let envelope = export_settings(app.handle().clone()).await.expect("export");
    let exported = &sections(&envelope)["connections"]["connections"];
    let first = exported.as_array().expect("list")[0]
        .as_object()
        .expect("object");
    assert!(
        !first.contains_key("password"),
        "password leaked into export"
    );
    assert!(
        !first.contains_key("hasPassword"),
        "hasPassword leaked into export"
    );
}

#[tokio::test]
async fn import_rejects_wrong_version_and_unknown_sections() {
    let _guard = crate::test_support::lock();
    let app = mock_app();

    let wrong_version = json!({ "version": 99, "exportedAt": "t", "sections": {} });
    let error = import_settings(app.handle().clone(), wrong_version, "merge".into())
        .await
        .expect_err("version must match");
    assert!(
        error.contains("version"),
        "error should name the version: {error}"
    );

    let unknown_section = json!({
        "version": 1, "exportedAt": "t",
        "sections": { "credentialsVault": { "passwords": [] } }
    });
    let error = import_settings(app.handle().clone(), unknown_section, "merge".into())
        .await
        .expect_err("unknown section must be rejected");
    assert!(
        error.contains("credentialsVault"),
        "error should name the section: {error}"
    );
}

#[tokio::test]
async fn import_rejects_secrets_arriving_inside_the_envelope_itself() {
    let _guard = crate::test_support::lock();
    let app = mock_app();
    let envelope = json!({
        "version": 1, "exportedAt": "t",
        "sections": {
            "connections": {
                "folders": [],
                "connections": [
                    { "id": "c1", "name": "Sneaky", "type": "SSH", "host": "h", "port": "22",
                      "user": "me", "password": "hunter2" }
                ]
            }
        }
    });

    import_settings(app.handle().clone(), envelope.clone(), "replace".into())
        .await
        .expect("import succeeds but strips secrets");

    let stored = connections::read_tree(app.handle()).expect("stored tree");
    let raw: Value = serde_json::to_value(&stored).expect("tree value");
    let first = &raw["connections"][0];
    assert!(first.get("password").is_none(), "secret survived import");
}

#[tokio::test]
async fn replace_overwrites_stores_while_merge_appends_without_colliding() {
    let _guard = crate::test_support::lock();
    let app = mock_app();
    settings::save_settings(
        app.handle().clone(),
        json!({ "fontSize": 18, "themeId": "tokyo" }),
    )
    .await
    .expect("seed setting");
    crate::workspace_persistence::write_workspaces(
        app.handle(),
        &[serde_json::from_value(json!({
            "id": "keep-me", "name": "Keep", "order": 0, "pins": [], "folders": []
        }))
        .expect("workspace")],
    )
    .expect("seed workspaces");

    let envelope = json!({
        "version": 1, "exportedAt": "t",
        "sections": {
            "appSettings": { "fontSize": 12 },
            "workspaces": [
                { "id": "keep-me", "name": "IgnoredOnMerge", "order": 5, "pins": [], "folders": [] },
                { "id": "fresh", "name": "Fresh", "order": 6, "pins": [], "folders": [] }
            ]
        }
    });

    // Merge: the incoming patch applies over what is stored; keys absent from the patch
    // keep their stored values.
    let report = import_settings(app.handle().clone(), envelope.clone(), "merge".into())
        .await
        .expect("merge import");
    let merged_settings = settings::read_settings(app.handle());
    assert_eq!(
        merged_settings["fontSize"], 12,
        "patch values apply on merge"
    );
    assert_eq!(
        merged_settings["themeId"], "tokyo",
        "untouched keys survive merge"
    );
    assert_eq!(
        crate::workspace_persistence::read_workspaces(app.handle())
            .expect("workspaces")
            .len(),
        2,
        "merge appends only non-colliding ids"
    );
    assert!(report["imported"]["workspaces"].is_u64());

    // Replace: incoming wins outright — a key absent from the patch falls back to defaults.
    import_settings(app.handle().clone(), envelope, "replace".into())
        .await
        .expect("replace import");
    let replaced_settings = settings::read_settings(app.handle());
    assert_eq!(replaced_settings["fontSize"], 12);
    assert_ne!(
        replaced_settings["themeId"], "tokyo",
        "replace must drop stored keys absent from the patch"
    );
    let replaced = crate::workspace_persistence::read_workspaces(app.handle()).expect("workspaces");
    assert_eq!(replaced.len(), 2);
    assert!(replaced.iter().any(|w| w.id == "fresh"));
    assert!(
        replaced.iter().all(|w| w.name != "Keep"),
        "replace must drop absent entries"
    );
}
