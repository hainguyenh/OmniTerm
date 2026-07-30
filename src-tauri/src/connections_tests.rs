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
