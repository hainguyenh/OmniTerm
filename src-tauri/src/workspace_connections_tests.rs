//! Tests for workspace-scoped connection profiles.
//!
//! The command wrappers need a running app, so these exercise the parts that do not: the file format
//! and the reader's tolerance of a workspace that has none.

use super::*;
use crate::connections::Connection;
use crate::workspace::Workspace;

fn conn(id: &str, conn_type: &str) -> Connection {
    Connection {
        id: id.to_string(),
        name: format!("conn {id}"),
        conn_type: conn_type.to_string(),
        host: "1.2.3.4".to_string(),
        port: "22".to_string(),
        user: "root".to_string(),
        password_help_url: None,
        parent_id: None,
        redirect_drives: None,
        shell: None,
        local_args: None,
        local_cwd: None,
        local_command: None,
        local_keep_open: None,
    }
}

fn temp_workspace() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("omniterm-wsconn-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// Writes `<dir>/.omniterm/connections.json` the way a user or an external tool would.
fn write_file(dir: &std::path::Path, connections: Vec<Connection>) {
    let omniterm = dir.join(".omniterm");
    fs::create_dir_all(&omniterm).unwrap();
    let json = serde_json::to_string_pretty(&WorkspaceConnectionsFile { connections }).unwrap();
    fs::write(omniterm.join("connections.json"), json).unwrap();
}

#[test]
fn the_file_round_trips_through_serde() {
    let file_data = WorkspaceConnectionsFile {
        connections: vec![conn("c1", "SSH")],
    };
    let json = serde_json::to_string(&file_data).unwrap();
    let back: WorkspaceConnectionsFile = serde_json::from_str(&json).unwrap();
    assert_eq!(back.connections.len(), 1);
    assert_eq!(back.connections[0].id, "c1");
    assert_eq!(back.connections[0].conn_type, "SSH");
}

/// `Connection` has no field for a secret, so a file someone hand-edited to add one loses it on read
/// rather than carrying it into the app. Same guarantee as the global tree.
#[test]
fn a_password_in_the_file_is_dropped_on_read() {
    let dir = temp_workspace();
    let omniterm = dir.join(".omniterm");
    fs::create_dir_all(&omniterm).unwrap();
    fs::write(
        omniterm.join("connections.json"),
        r#"{"connections":[{"id":"c1","name":"x","type":"SSH","host":"h","port":"22","user":"u","password":"hunter2"}]}"#,
    )
    .unwrap();

    let conns = read_at(dir.to_str().unwrap()).unwrap();
    assert_eq!(conns.len(), 1);
    let as_value = serde_json::to_value(&conns[0]).unwrap();
    assert!(
        as_value.get("password").is_none(),
        "a secret must not survive the read"
    );
    assert!(!serde_json::to_string(&conns).unwrap().contains("hunter2"));

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_workspace_with_no_profiles_reads_as_empty_rather_than_erroring() {
    let dir = temp_workspace();
    assert_eq!(read_at(dir.to_str().unwrap()).unwrap().len(), 0);

    // Present but empty — a file someone truncated.
    let omniterm = dir.join(".omniterm");
    fs::create_dir_all(&omniterm).unwrap();
    fs::write(omniterm.join("connections.json"), "   \n").unwrap();
    assert_eq!(read_at(dir.to_str().unwrap()).unwrap().len(), 0);

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_corrupt_file_reports_rather_than_being_silently_discarded() {
    let dir = temp_workspace();
    let omniterm = dir.join(".omniterm");
    fs::create_dir_all(&omniterm).unwrap();
    fs::write(omniterm.join("connections.json"), "{ not json").unwrap();

    let err = read_at(dir.to_str().unwrap()).unwrap_err();
    assert!(err.contains("corrupt"), "got {err}");

    fs::remove_dir_all(&dir).ok();
}

/// A workspace path that does not validate must yield nothing, not an error — one bad project folder
/// cannot be allowed to make every other workspace's connections unresolvable via `find_by_id`.
#[test]
fn an_unvalidatable_workspace_path_reads_as_empty() {
    assert_eq!(read_at("").unwrap().len(), 0);
    assert_eq!(read_at("relative/not/absolute").unwrap().len(), 0);
}

/// `connections_path(.., false)` must not create anything. The write path used to `create_dir_all` the
/// unvalidated join *before* validating it, so merely reading — or a rejected write — left a `.omniterm`
/// directory inside the user's project.
#[test]
fn reading_creates_no_directory() {
    let dir = temp_workspace();
    let _ = read_at(dir.to_str().unwrap());
    assert!(
        !dir.join(".omniterm").exists(),
        "a read must not create .omniterm"
    );
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn read_at_reads_saved_connections_and_find_by_id_locates_them() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let dir = temp_workspace();
    write_file(&dir, vec![conn("ws-target-1", "SSH")]);
    let back = read_at(dir.to_str().unwrap()).expect("read_at");
    assert_eq!(back.len(), 1);
    assert_eq!(back[0].id, "ws-target-1");

    let ws = Workspace {
        id: "ws#lookup".to_string(),
        name: "Lookup".to_string(),
        folders: vec![WorkspaceFolder {
            id: "folder#lookup".to_string(),
            name: "Lookup".to_string(),
            path: dir.to_str().unwrap().to_string(),
            color: None,
        }],
        parent_id: None,
        order: 0,
        pins: Vec::new(),
        color: None,
        icon: None,
    };
    if let Ok(path) = crate::workspace_persistence::workspaces_file(app.handle()) {
        let _ = std::fs::remove_file(&path);
        let _ = crate::workspace_persistence::write_workspaces(app.handle(), &[ws]);
        let found = find_by_id(app.handle(), "ws-target-1");
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, "ws-target-1");
        assert!(find_by_id(app.handle(), "ghost").is_none());
        let _ = std::fs::remove_file(path);
    }
    fs::remove_dir_all(&dir).ok();
}
