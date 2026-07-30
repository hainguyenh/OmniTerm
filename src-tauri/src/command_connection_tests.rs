use super::*;
use crate::connections::{ConnectionTree, Folder};
use serde_json::json;

#[test]
fn global_connection_commands_round_trip_validate_and_scrub_legacy_secrets() {
    let fixture = MockApp::new();
    let app = fixture.handle();
    let host = fixture.app.state::<PluginHost>();

    let empty = block_on(connections::load_connections(app.clone(), host.clone())).unwrap();
    assert!(empty.connections.is_empty());
    assert!(empty.folders.is_empty());

    let tree = ConnectionTree {
        folders: vec![Folder {
            id: "servers".to_string(),
            name: "Servers".to_string(),
            parent_id: None,
        }],
        connections: vec![Connection {
            parent_id: Some("servers".to_string()),
            ..connection("ssh-main")
        }],
    };
    block_on(connections::save_connections(
        app.clone(),
        host.clone(),
        tree,
    ))
    .unwrap();
    let loaded = block_on(connections::load_connections(app.clone(), host.clone())).unwrap();
    assert_eq!(loaded.folders.len(), 1);
    assert_eq!(loaded.connections[0].id, "ssh-main");

    let invalid = ConnectionTree {
        folders: Vec::new(),
        connections: vec![Connection {
            conn_type: "TELNET".to_string(),
            ..connection("bad")
        }],
    };
    assert!(block_on(connections::save_connections(
        app.clone(),
        host.clone(),
        invalid,
    ))
    .is_err());

    let path = connections::connections_path(&app).unwrap();
    write_file(
        &path,
        serde_json::to_vec_pretty(&json!({
            "folders": [],
            "connections": [{
                "id": "legacy",
                "name": "Legacy",
                "type": "SSH",
                "host": "legacy.test",
                "port": "22",
                "user": "root",
                "password": "must-disappear",
                "hasPassword": true
            }]
        }))
        .unwrap(),
    );
    connections::scrub_stored_secrets(&app);
    let scrubbed = fs::read_to_string(&path).unwrap();
    assert!(!scrubbed.contains("must-disappear"));
    assert!(!scrubbed.contains("hasPassword"));
    assert_eq!(connections::read_tree(&app).unwrap().connections.len(), 1);

    write_file(&path, b"");
    assert!(connections::read_tree(&app).unwrap().connections.is_empty());
    write_file(&path, b"{broken-json");
    let error = connections::read_tree(&app).unwrap_err();
    assert!(error.contains("connections.json is corrupt"));

    connections::scrub_stored_secrets(&app);
    let _ = fs::remove_file(path);
    connections::scrub_stored_secrets(&app);
}
