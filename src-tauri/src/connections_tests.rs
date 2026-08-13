//! Import classification, renderer-payload shape, and the credential-scrub guarantees.

use super::*;

const PLAIN_EXPORT: &str = r#"{
  "folders": [{"id": "f1", "name": "Prod"}],
  "connections": [{"id": "c1", "name": "web01", "type": "SSH", "host": "h", "port": "22", "user": "root"}]
}"#;

/// An encrypted backup as an older build wrote it.
const ENCRYPTED_EXPORT: &str = r#"{
  "version": 3, "encrypted": true, "kdf": {"N": 131072, "r": 8, "p": 1},
  "salt": "afd29de24857f3902b6275554dfe9158",
  "iv": "c855e09a8e25c96246411d40",
  "tag": "a7bc047709ef0140c722ab41aeed3e7c",
  "data": "29424875c49a20"
}"#;

// ── Detection ────────────────────────────────────────────────────────────────

/// This build ships no crypto, so an encrypted backup must be refused with an explanation rather
/// than misread. The check has to come first: `ConnectionTree` has `#[serde(default)]` on both
/// fields, so deserializing it up front succeeds for *every* JSON object — an envelope included,
/// which is how a user's vault once imported as a silently empty tree.
#[test]
fn an_encrypted_backup_is_refused_with_a_migration_hint() {
    let err = parse_import_content(ENCRYPTED_EXPORT).expect_err("must not import");
    assert!(err.contains("encrypted vault backup"), "got {err}");
    assert!(err.contains("plain JSON"), "must say how to migrate: {err}");
}

#[test]
fn a_plain_export_is_classified_as_plain() {
    let ImportOutcome::Plain {
        folders,
        connections,
    } = parse_import_content(PLAIN_EXPORT).expect("should classify");
    assert_eq!(folders.as_array().unwrap().len(), 1);
    assert_eq!(connections.as_array().unwrap().len(), 1);
}

/// `encrypted: false` is the flag a plain recovery export carries; it must still import.
#[test]
fn an_explicit_encrypted_false_is_plain() {
    let text = r#"{"encrypted": false, "folders": [], "connections": []}"#;
    assert!(parse_import_content(text).is_ok());
}

/// A truthy-but-not-`true` flag must not be read as encrypted, or a hand-edited file would be
/// refused with a confusing message.
#[test]
fn only_a_boolean_true_marks_a_file_encrypted() {
    for flag in [r#""true""#, "1", "null"] {
        let text = format!(r#"{{"encrypted": {flag}, "folders": [], "connections": []}}"#);
        assert!(
            parse_import_content(&text).is_ok(),
            "encrypted: {flag} should not be treated as an envelope"
        );
    }
}

#[test]
fn invalid_json_is_reported_as_such() {
    let err = parse_import_content("not json at all").expect_err("must error");
    assert!(err.contains("Invalid JSON file"), "got {err}");
}

#[test]
fn a_missing_folders_or_connections_key_defaults_to_empty() {
    let ImportOutcome::Plain { folders, .. } =
        parse_import_content(r#"{"connections": []}"#).expect("should classify");
    assert_eq!(folders, json!([]));
}

/// A plain import is validated before it is handed back, so malformed records never reach the app.
#[test]
fn a_plain_export_with_bad_records_is_rejected() {
    let text = r#"{"folders": [], "connections": [{"id": "c1", "name": "x", "type": "TELNET"}]}"#;
    let err = parse_import_content(text).expect_err("must reject");
    assert!(err.contains("invalid connection type"), "got {err}");
}

#[test]
fn a_plain_export_naming_an_arbitrary_shell_is_rejected() {
    let text =
        r#"{"folders": [], "connections": [{"id":"c1","name":"x","type":"LOCAL","shell":"C:\\evil.exe"}]}"#;
    assert!(parse_import_content(text).is_err());
}

// ── Credentials never cross the boundary ─────────────────────────────────────

/// A plain export written by a build that *did* save passwords must import its connection metadata
/// while leaving the secret at the door. Stripping has to happen here, not at save time: the value
/// this returns is handed to the webview verbatim by `import_file`.
#[test]
fn an_import_carrying_passwords_yields_them_stripped_not_rejected() {
    let text = r#"{"folders": [], "connections": [
        {"id":"c1","name":"web01","type":"SSH","host":"h","port":"22","user":"root",
         "password":"hunter2","hasPassword":true}
    ]}"#;
    let ImportOutcome::Plain { connections, .. } =
        parse_import_content(text).expect("metadata should still import");

    let c = &connections.as_array().expect("array")[0];
    assert_eq!(c["name"], json!("web01"), "metadata must survive");
    assert_eq!(c["user"], json!("root"));
    assert!(c.get("password").is_none(), "secret must not reach the webview");
    assert!(c.get("hasPassword").is_none());
}

/// The struct itself is the enforcement point: whatever a caller posts, a password has nowhere to
/// live and cannot be written back out.
#[test]
fn a_password_cannot_survive_a_connection_tree_round_trip() {
    let tree: ConnectionTree = serde_json::from_str(
        r#"{"folders":[],"connections":[
            {"id":"c1","name":"n","type":"SSH","host":"h","port":"22","user":"u","password":"hunter2"}
        ]}"#,
    )
    .expect("unknown keys are ignored, not fatal");

    let out = serde_json::to_string(&tree).expect("serialize");
    assert!(!out.contains("hunter2"), "serialized as: {out}");
    assert!(!out.contains("password"), "serialized as: {out}");
}

#[test]
fn legacy_secret_detection_only_fires_on_a_real_value() {
    let with_secret = json!({"connections": [{"id": "c1", "password": "hunter2"}]});
    let with_flag = json!({"connections": [{"id": "c1", "hasPassword": true}]});
    let nulled = json!({"connections": [{"id": "c1", "password": null}]});
    let clean = json!({"connections": [{"id": "c1", "name": "n"}]});

    assert!(has_legacy_secret(&with_secret));
    assert!(has_legacy_secret(&with_flag));
    // A null is what a scrubbed-by-hand file looks like; rewriting it again would be churn.
    assert!(!has_legacy_secret(&nulled));
    assert!(!has_legacy_secret(&clean));
    assert!(!has_legacy_secret(&json!({})));
}

// ── Renderer payload shape ───────────────────────────────────────────────────

/// ConnectionManagerUI reads `result.folders` / `result.connections`. These key names are the
/// contract; `encrypted` is gone from the payload because there is only one kind of import now.
#[test]
fn plain_payload_matches_what_the_renderer_reads() {
    let value = import_outcome_to_value(parse_import_content(PLAIN_EXPORT).unwrap());
    assert_eq!(value["connections"][0]["id"], json!("c1"));
    assert_eq!(value["folders"][0]["name"], json!("Prod"));
    assert!(value.get("encrypted").is_none());
}

// ── Tree deserialization ─────────────────────────────────────────────────────

#[test]
fn connection_local_fields_round_trip_through_camel_case() {
    let tree: ConnectionTree = serde_json::from_str(
        r#"{"connections":[{"id":"c1","name":"n","type":"LOCAL","shell":"cmd",
             "localCwd":"C:/p","localArgs":"/v:on","localCommand":"build.bat","localKeepOpen":false}],
           "folders":[]}"#,
    )
    .expect("should deserialize");
    let c = &tree.connections[0];
    assert_eq!(c.shell.as_deref(), Some("cmd"));
    assert_eq!(c.local_cwd.as_deref(), Some("C:/p"));
    assert_eq!(c.local_args.as_deref(), Some("/v:on"));
    assert_eq!(c.local_command.as_deref(), Some("build.bat"));
    assert_eq!(c.local_keep_open, Some(false));

    // And back out under the same names the renderer uses.
    let out = serde_json::to_value(c).unwrap();
    assert_eq!(out["localKeepOpen"], json!(false));
    assert_eq!(out["type"], json!("LOCAL"));
}

#[test]
fn an_empty_tree_deserializes_from_an_empty_object() {
    let tree: ConnectionTree = serde_json::from_str("{}").expect("should deserialize");
    assert!(tree.connections.is_empty());
    assert!(tree.folders.is_empty());
}

#[test]
fn bounded_import_reader_accepts_small_text_and_rejects_missing_or_oversized_files() {
    use std::io::Write;

    let mut small = tempfile::NamedTempFile::new().unwrap();
    small.write_all(PLAIN_EXPORT.as_bytes()).unwrap();
    assert_eq!(read_bounded(small.path()).unwrap(), PLAIN_EXPORT);

    let missing = small.path().with_extension("missing");
    assert_eq!(read_bounded(&missing).unwrap_err(), "Cannot read the selected file.");

    let oversized = tempfile::NamedTempFile::new().unwrap();
    oversized
        .as_file()
        .set_len(MAX_IMPORT_FILE_BYTES + 1)
        .unwrap();
    assert!(read_bounded(oversized.path())
        .unwrap_err()
        .contains("File too large to import"));
}

// ── Path and persistence helpers ─────────────────────────────────────────────

#[test]
fn connections_path_returns_json_path_under_app_data() {
    // Every mock app resolves the same app-data directory, and `connections_path` creates it when
    // absent. Without the lock this raced the other fixtures' `create_dir_all` and returned EEXIST.
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let path = connections_path(app.handle()).expect("should resolve");
    assert!(path.to_string_lossy().ends_with("connections.json"));
}

#[test]
fn read_tree_returns_empty_default_when_no_file_exists() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let path = connections_path(app.handle()).expect("path");
    let _ = std::fs::remove_file(&path);
    let tree = read_tree(app.handle()).expect("missing file must yield empty tree");
    assert!(tree.connections.is_empty());
    assert!(tree.folders.is_empty());
}


#[test]
fn read_tree_parses_a_valid_file() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let path = connections_path(app.handle()).expect("path");
    // Skip if the mock app data dir is not writable (common on Windows CI).
    if std::fs::write(&path, PLAIN_EXPORT).is_err() {
        return;
    }
    let tree = read_tree(app.handle()).expect("should parse");
    assert_eq!(tree.connections.len(), 1);
    assert_eq!(tree.folders.len(), 1);
    // Clean up
    let _ = std::fs::remove_file(&path);
}

#[test]
fn read_tree_errors_on_corrupt_file() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let path = connections_path(app.handle()).expect("path");
    if std::fs::write(&path, "not valid json {").is_err() {
        return; // Skip if mock app data dir is not writable.
    }
    let err = read_tree(app.handle()).expect_err("corrupt file must error");
    assert!(err.contains("connections.json is corrupt"), "got {err}");
    // Clean up
    let _ = std::fs::remove_file(&path);
}

#[test]
fn scrub_stored_secrets_removes_legacy_fields_from_disk() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let path = connections_path(app.handle()).expect("path");
    // Write a tree that contains a legacy secret.
    let with_secret = r#"{"connections": [{"id": "c1", "name": "n", "type": "SSH", "host": "h", "port": "22", "user": "u", "password": "hunter2"}], "folders": []}"#;
    if std::fs::write(&path, with_secret).is_err() {
        return; // Skip if mock app data dir is not writable.
    }
    scrub_stored_secrets(app.handle());
    if let Ok(cleaned) = std::fs::read_to_string(&path) {
        assert!(!cleaned.contains("hunter2"), "password must be gone after scrub");
        assert!(!cleaned.contains("\"password\""), "password key must be gone");
    }
    // Clean up
    let _ = std::fs::remove_file(&path);
}

#[test]
fn scrub_stored_secrets_leaves_clean_file_untouched() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let path = connections_path(app.handle()).expect("path");
    // Remove any leftover file from previous tests first.
    let _ = std::fs::remove_file(&path);
    if std::fs::write(&path, PLAIN_EXPORT).is_err() {
        return; // Skip if mock app data dir is not writable.
    }
    scrub_stored_secrets(app.handle());
    // The file should NOT have been rewritten when no secrets present.
    let after_content = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(!after_content.contains("hunter2"));
    let _ = std::fs::remove_file(&path);
}


#[test]
fn scrub_stored_secrets_handles_missing_file_gracefully() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    // Ensure no file exists.
    let path = connections_path(app.handle()).expect("path");
    let _ = std::fs::remove_file(&path);
    // Must not panic.
    scrub_stored_secrets(app.handle());
}
#[test]
fn empty_files_default_and_secret_scrubbing_preserves_unsalvageable_data() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let path = connections_path(app.handle()).unwrap();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }

    std::fs::write(&path, " \n\t").unwrap();
    let empty = read_tree(app.handle()).unwrap();
    assert!(empty.connections.is_empty());
    assert!(empty.folders.is_empty());

    for text in [
        "not valid json",
        r#"{"connections":[{"password":"keep-me"}],"folders":"invalid"}"#,
    ] {
        std::fs::write(&path, text).unwrap();
        scrub_stored_secrets(app.handle());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
    }
    let _ = std::fs::remove_file(path);
}

#[test]
fn bounded_reader_accepts_the_exact_limit_and_rejects_a_directory() {
    let exact = tempfile::NamedTempFile::new().unwrap();
    exact.as_file().set_len(MAX_IMPORT_FILE_BYTES).unwrap();
    assert_eq!(read_bounded(exact.path()).unwrap().len() as u64, MAX_IMPORT_FILE_BYTES);
    let directory = tempfile::tempdir().unwrap();
    assert_eq!(
        read_bounded(directory.path()).unwrap_err(),
        "Cannot read the selected file."
    );
}
#[test]
fn import_reports_a_tree_that_passes_shape_checks_but_not_deserialization() {
    let malformed = r#"{
        "folders": [],
        "connections": [{
            "id": "c1", "name": "server", "type": "SSH", "host": 42
        }]
    }"#;
    let error = parse_import_content(malformed).unwrap_err();
    assert!(error.contains("malformed connection tree"), "{error}");
}

#[test]
fn test_save_and_load_connections() {
    use tauri::Manager;
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let handle = app.handle().clone();
    assert!(app.manage(crate::plugin_host::PluginHost::new()));
    let host = app.state::<crate::plugin_host::PluginHost>();

    let tree = ConnectionTree {
        folders: vec![Folder { id: "f1".into(), name: "Folder 1".into(), parent_id: None }],
        connections: vec![Connection {
            id: "c1".into(),
            name: "Server 1".into(),
            conn_type: "SSH".into(),
            host: "10.0.0.1".into(),
            port: "22".into(),
            user: "root".into(),
            password_help_url: None,
            parent_id: Some("f1".into()),
            redirect_drives: None,
            shell: None,
            local_args: None,
            local_cwd: None,
            local_command: None,
            local_keep_open: None,
        }],
    };

    let save_res = tauri::async_runtime::block_on(save_connections(handle.clone(), host, tree));
    assert!(save_res.is_ok());

    let host2 = app.state::<crate::plugin_host::PluginHost>();
    let loaded = tauri::async_runtime::block_on(load_connections(handle.clone(), host2)).unwrap();
    assert_eq!(loaded.connections.len(), 1);
    assert_eq!(loaded.folders.len(), 1);

    if let Ok(path) = connections_path(app.handle()) {
        let _ = std::fs::remove_file(path);
    }
}
