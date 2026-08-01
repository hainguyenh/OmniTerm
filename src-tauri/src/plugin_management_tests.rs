//! Unit tests for plugin package validation. Native dialogs and app restart are integration concerns;
//! these tests cover every pure rejection path before an archive can write executable files.

use super::*;

fn manifest() -> Vec<u8> {
    br#"{"name":"@x/demo","version":"1.2.3","main":"dist/index.js","omnitermPlugin":{"apiVersion":2,"displayName":"Demo","permissions":["connections"]}}"#.to_vec()
}

#[test]
fn safe_directory_names_replace_only_filesystem_metacharacters() {
    assert_eq!(safe_dir_name("@scope/demo"), "@scope_demo");
    assert_eq!(safe_dir_name("a\\b?c%d*e:f|g\"h<i>j"), "a_b_c_d_e_f_g_h_i_j");
    assert_eq!(safe_dir_name("normal.plugin-name"), "normal.plugin-name");
}

#[test]
fn checked_directory_names_reject_empty_special_and_control_names() {
    for unsafe_id in ["", ".", "..", "bad\nname", "bad\0name"] {
        assert!(checked_dir_name(unsafe_id).is_err(), "{unsafe_id:?} must be rejected");
    }
    assert_eq!(checked_dir_name("@x/demo").unwrap(), "@x_demo");
}

#[test]
fn manifest_reads_supported_metadata_and_defaults() {
    let parsed = parse_manifest(&manifest()).unwrap();
    assert_eq!(parsed.id, "@x/demo");
    assert_eq!(parsed.name, "Demo");
    assert_eq!(parsed.version, "1.2.3");
    assert_eq!(parsed.main, "dist/index.js");
    assert_eq!(parsed.permissions, vec!["connections"]);

    let minimal = br#"{"name":"demo","omnitermPlugin":{"apiVersion":2}}"#;
    let parsed = parse_manifest(minimal).unwrap();
    assert_eq!(parsed.name, "Unnamed plugin");
    assert_eq!(parsed.version, "0.0.0");
    assert_eq!(parsed.main, "dist/index.js");
    assert!(parsed.permissions.is_empty());
}

#[test]
fn manifest_rejects_invalid_json_and_non_plugin_packages() {
    assert!(parse_manifest(b"not json").unwrap_err().contains("not valid JSON"));
    assert!(parse_manifest(br#"{"name":"demo"}"#)
        .unwrap_err()
        .contains("not an OmniTerm plugin"));
    assert!(parse_manifest(br#"{"omnitermPlugin":{"apiVersion":2}}"#)
        .unwrap_err()
        .contains("no valid name"));
}

#[test]
fn manifest_requires_api_v2() {
    for value in [
        &br#"{"name":"x","omnitermPlugin":{}}"#[..],
        &br#"{"name":"x","omnitermPlugin":{"apiVersion":1}}"#[..],
        &br#"{"name":"x","omnitermPlugin":{"apiVersion":3}}"#[..],
    ] {
        assert!(parse_manifest(value).unwrap_err().contains("requires version 2"));
    }
}

#[test]
fn manifest_requires_string_known_permissions() {
    let non_string = br#"{"name":"x","omnitermPlugin":{"apiVersion":2,"permissions":[1]}}"#;
    assert!(parse_manifest(non_string)
        .unwrap_err()
        .contains("permissions must be strings"));

    for permission in ["root", "credentials"] {
        let bytes = format!(
            r#"{{"name":"x","omnitermPlugin":{{"apiVersion":2,"permissions":["{permission}"]}}}}"#,
        );
        assert!(parse_manifest(bytes.as_bytes())
            .unwrap_err()
            .contains("unknown permission"));
    }

    let all = KNOWN_PERMISSIONS
        .iter()
        .map(|permission| format!(r#""{permission}""#))
        .collect::<Vec<_>>()
        .join(",");
    let bytes = format!(
        r#"{{"name":"x","omnitermPlugin":{{"apiVersion":2,"permissions":[{all}]}}}}"#,
    );
    assert_eq!(parse_manifest(bytes.as_bytes()).unwrap().permissions.len(), KNOWN_PERMISSIONS.len());
}

#[test]
fn manifest_rejects_unsafe_package_and_entrypoint_names() {
    for id in [".."] {
        let bytes = format!(r#"{{"name":"{id}","omnitermPlugin":{{"apiVersion":2}}}}"#);
        assert!(parse_manifest(bytes.as_bytes()).unwrap_err().contains("unsafe"));
    }
    for main in ["../evil.js", "dist/../../evil.js", "/tmp/evil.js", "..\\evil.js"] {
        let bytes = serde_json::to_vec(&serde_json::json!({
            "name": "x",
            "main": main,
            "omnitermPlugin": { "apiVersion": 2 },
        }))
        .unwrap();
        assert!(parse_manifest(&bytes).unwrap_err().contains("main path is unsafe"));
    }
}
