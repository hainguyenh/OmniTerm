use super::*;

#[test]
fn workspace_folder_round_trips_through_json() {
    let folder = WorkspaceFolder {
        id: "folder#1".to_string(),
        name: "Root".to_string(),
        path: "/path/to/root".to_string(),
        color: None,
    };
    let json = serde_json::to_string(&folder).expect("serialize folder");
    let back: WorkspaceFolder = serde_json::from_str(&json).expect("deserialize folder");
    assert_eq!(folder, back);
    assert_eq!(format!("{folder:?}"), format!("{back:?}"));
}

#[test]
fn workspace_pin_supports_defaults_and_round_trip() {
    let pin = WorkspacePin {
        folder_id: "folder#1".to_string(),
        path: "src/main.rs".to_string(),
    };
    let json = serde_json::to_string(&pin).expect("serialize pin");
    let back: WorkspacePin = serde_json::from_str(&json).expect("deserialize pin");
    assert_eq!(pin, back);

    let from_minimal: WorkspacePin = serde_json::from_str(r#"{"folderId":"folder#1"}"#)
        .expect("deserialize minimal pin");
    assert_eq!(from_minimal.folder_id, "folder#1");
    assert_eq!(from_minimal.path, "");
}

#[test]
fn workspace_supports_optional_and_default_fields() {
    let ws = Workspace {
        id: "ws#1".to_string(),
        name: "OmniTerm".to_string(),
        folders: vec![WorkspaceFolder {
            id: "folder#1".to_string(),
            name: "OmniTerm".to_string(),
            path: "/repo".to_string(),
            color: None,
        }],
        parent_id: Some("ws#parent".to_string()),
        order: 3,
        pins: vec![WorkspacePin {
            folder_id: "folder#1".to_string(),
            path: "README.md".to_string(),
        }],
        color: None,
        icon: None,
    };
    let json = serde_json::to_string(&ws).expect("serialize workspace");
    let back: Workspace = serde_json::from_str(&json).expect("deserialize workspace");
    assert_eq!(ws, back);

    let minimal: Workspace = serde_json::from_str(r#"{"id":"ws#min","name":"Min"}"#)
        .expect("deserialize minimal workspace");
    assert_eq!(minimal.id, "ws#min");
    assert_eq!(minimal.name, "Min");
    assert!(minimal.folders.is_empty());
    assert_eq!(minimal.parent_id, None);
    assert_eq!(minimal.order, 0);
    assert!(minimal.pins.is_empty());
}

#[test]
fn workspace_appearance_fields_round_trip() {
    let ws = Workspace {
        id: "ws#appearance".to_string(),
        name: "Appearance".to_string(),
        folders: vec![WorkspaceFolder {
            id: "folder#appearance".to_string(),
            name: "Appearance".to_string(),
            path: "/appearance".to_string(),
            color: Some("purple".to_string()),
        }],
        parent_id: None,
        order: 0,
        pins: Vec::new(),
        color: Some("blue".to_string()),
        icon: Some("star".to_string()),
    };
    let back: Workspace = serde_json::from_str(
        &serde_json::to_string(&ws).expect("serialize workspace appearance"),
    ).expect("deserialize workspace appearance");
    assert_eq!(back, ws);
}

#[test]
fn workspace_import_debug_and_clone() {
    let import = WorkspaceImport {
        name: "Imported".to_string(),
        folders: vec![WorkspaceFolder {
            id: "folder#1".to_string(),
            name: "One".to_string(),
            path: "/one".to_string(),
            color: None,
        }],
    };
    let cloned = import.clone();
    assert_eq!(import, cloned);
    assert_eq!(format!("{import:?}"), format!("{cloned:?}"));
}
