//! Imported-tree validation tests.
//!
//! An import is attacker-influenceable input — the user may have been handed the file — so the cases
//! below are about what must be *refused*, not what must be accepted.

use super::*;
use serde_json::json;

#[test]
fn accepts_a_well_formed_tree() {
    let folders = json!([{"id": "f1", "name": "Prod"}]);
    let connections = json!([
        {"id": "c1", "name": "web01", "type": "SSH", "host": "h", "port": "22", "user": "root"},
        {"id": "c2", "name": "shell", "type": "LOCAL", "shell": "powershell", "localCwd": "C:/x"},
    ]);
    assert!(validate_tree(&folders, &connections).is_ok());
}

#[test]
fn rejects_non_array_inputs() {
    assert!(validate_tree(&json!({}), &json!([])).is_err());
    assert!(validate_tree(&json!([]), &json!("nope")).is_err());
    assert!(validate_tree(&json!(null), &json!(null)).is_err());
}

#[test]
fn rejects_bad_ids_names_and_types() {
    let ok_folders = json!([]);
    let cases = vec![
        json!([{"name": "no id", "type": "SSH"}]),
        json!([{"id": "", "name": "empty id", "type": "SSH"}]),
        json!([{"id": "x".repeat(129), "name": "long id", "type": "SSH"}]),
        json!([{"id": "c1", "name": "x".repeat(257), "type": "SSH"}]),
        json!([{"id": "c1", "name": "bad type", "type": "TELNET"}]),
        json!([{"id": "c1", "name": "no type"}]),
        json!(["not an object"]),
    ];
    for c in cases {
        assert!(
            validate_tree(&ok_folders, &c).is_err(),
            "should have rejected {c}"
        );
    }
}

/// If an arbitrary `shell` string survived import it would reach the PTY the next time the user
/// opened that connection. Every shell the connection form can produce must still save: an earlier
/// validator hard-coded the three Windows shells, so a Mac user — whose form defaults to `default`
/// and offers `zsh`/`bash`/`sh` — could not save a LOCAL connection at all.
#[test]
fn accepts_every_shell_the_connection_form_offers() {
    for shell in ["wsl", "powershell", "cmd", "default", "zsh", "bash", "sh"] {
        let c = json!([{"id": "c1", "name": "n", "type": "LOCAL", "shell": shell}]);
        assert!(
            validate_tree(&json!([]), &c).is_ok(),
            "{shell} must be savable"
        );
    }
}

#[test]
fn rejects_a_connection_naming_an_arbitrary_shell() {
    let hostile = json!([{"id": "c1", "name": "evil", "type": "LOCAL", "shell": "C:\\evil.exe"}]);
    let err = validate_tree(&json!([]), &hostile).expect_err("must reject");
    assert!(err.contains("invalid connection shell"), "got {err}");
}

#[test]
fn rejects_oversized_local_fields() {
    for field in ["localArgs", "localCwd", "localCommand"] {
        let c = json!([{"id": "c1", "name": "n", "type": "LOCAL", field: "x".repeat(4097)}]);
        assert!(validate_tree(&json!([]), &c).is_err(), "{field} unbounded");
    }
}

/// A `password` key is no longer part of the schema, so validation neither bounds it nor trips over
/// it — `parse_import_content` strips it structurally instead. Asserted so nobody "restores" a
/// password length check here and quietly re-blesses the field as importable.
#[test]
fn a_password_key_does_not_fail_validation() {
    let c = json!([{"id": "c1", "name": "n", "type": "SSH", "password": "x".repeat(9000)}]);
    assert!(validate_tree(&json!([]), &c).is_ok());
}

#[test]
fn rejects_non_boolean_flags() {
    for field in ["localKeepOpen", "redirectDrives"] {
        let c = json!([{"id": "c1", "name": "n", "type": "LOCAL", field: "yes"}]);
        assert!(validate_tree(&json!([]), &c).is_err(), "{field} not checked");
    }
}

#[test]
fn rejects_more_records_than_the_cap() {
    let many: Vec<_> = (0..10_001)
        .map(|i| json!({"id": format!("f{i}"), "name": "x"}))
        .collect();
    let err = validate_tree(&json!(many), &json!([])).expect_err("must reject");
    assert!(err.contains("too many records"), "got {err}");
}

#[test]
fn null_optional_fields_are_treated_as_absent() {
    let c = json!([{
        "id": "c1", "name": "n", "type": "LOCAL",
        "shell": null, "localCwd": null, "localKeepOpen": null
    }]);
    assert!(validate_tree(&json!([]), &c).is_ok());
}

#[test]
fn rejects_invalid_folder_records() {
    let cases = vec![
        json!(["not an object"]),
        json!([{"name": "No ID"}]),
        json!([{"id": "", "name": "Empty ID"}]),
        json!([{"id": "f1"}]), // missing name
        json!([{"id": "f1", "name": "x".repeat(257)}]),
        json!([{"id": "f1", "name": "Valid", "parentId": "x".repeat(129)}]),
        json!([{"id": "f1", "name": "Valid", "parentId": 123}]),
    ];
    for f in cases {
        assert!(validate_tree(&f, &json!([])).is_err(), "should reject folder case {f}");
    }
}


#[test]
fn accepts_exact_boundaries_parent_links_and_boolean_flags() {
    let folders = json!([{
        "id": "i".repeat(MAX_ID_LENGTH),
        "name": "n".repeat(MAX_NAME_LENGTH),
        "parentId": "p".repeat(MAX_ID_LENGTH),
    }, {
        "id": "child",
        "name": "Child",
        "parentId": null,
    }]);
    let connections = json!([{
        "id": "c".repeat(MAX_ID_LENGTH),
        "name": "n".repeat(MAX_NAME_LENGTH),
        "type": "LOCAL",
        "shell": null,
        "localArgs": "a".repeat(MAX_LOCAL_FIELD_LENGTH),
        "localCwd": "c".repeat(MAX_LOCAL_FIELD_LENGTH),
        "localCommand": "x".repeat(MAX_LOCAL_FIELD_LENGTH),
        "localKeepOpen": true,
        "redirectDrives": false,
    }]);
    assert!(validate_tree(&folders, &connections).is_ok());
}

#[test]
fn rejects_wrong_optional_string_types_and_too_many_connections() {
    for field in ["localArgs", "localCwd", "localCommand"] {
        let connection = json!([{
            "id": "c1", "name": "n", "type": "LOCAL", (field): 7
        }]);
        assert!(validate_tree(&json!([]), &connection).is_err());
    }

    let many: Vec<_> = (0..=MAX_RECORDS)
        .map(|index| json!({"id": format!("c{index}"), "name": "n", "type": "SSH"}))
        .collect();
    assert!(validate_tree(&json!([]), &json!(many)).is_err());
}
