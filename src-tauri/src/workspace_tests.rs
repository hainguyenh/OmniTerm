//! Workspace-list tests. The scan and its classification live in workspace_scan_tests.rs, next to
//! the module that owns them; workspace-scoped connection profiles in workspace_connections_tests.rs.

use super::*;

#[test]
fn workspaces_serialize_with_camel_case_fields() {
    let ws = Workspace {
        id: "ws#1".to_string(),
        name: "proj".to_string(),
        path: "C:/proj".to_string(),
        pinned: Some(true),
    };
    let value = serde_json::to_value(&ws).unwrap();
    assert_eq!(value["id"], serde_json::json!("ws#1"));
    assert_eq!(value["pinned"], serde_json::json!(true));
}

/// `pinned` is optional in the file: a workspaces.json written before the field existed must still
/// load rather than failing the whole list.
#[test]
fn a_workspace_without_pinned_still_deserializes() {
    let ws: Workspace =
        serde_json::from_str(r#"{"id":"ws#1","name":"proj","path":"C:/proj"}"#).unwrap();
    assert_eq!(ws.pinned, None);
}
