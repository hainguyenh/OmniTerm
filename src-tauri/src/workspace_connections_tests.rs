//! Tests for workspace-scoped connection profiles.
//!
//! The command wrappers need a running app, so these exercise the parts that do not: the file format,
//! the reader's tolerance of a workspace that has none, and the ordering that keeps a rejected write
//! from leaving a directory behind.

use super::*;
use crate::connections::Connection;

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
    assert!(as_value.get("password").is_none(), "a secret must not survive the read");
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
    assert!(!dir.join(".omniterm").exists(), "a read must not create .omniterm");
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn the_size_cap_is_enforced_before_the_directory_is_created() {
    let dir = temp_workspace();
    // One connection per 100-odd bytes; 20k of them comfortably clears 1 MB.
    let many: Vec<Connection> = (0..20_000).map(|i| conn(&format!("c{i}"), "LOCAL")).collect();
    let json = serde_json::to_string_pretty(&WorkspaceConnectionsFile { connections: many }).unwrap();
    assert!(json.len() > MAX_BYTES, "fixture should exceed the cap");

    // The cap is checked against the serialized payload, before `connections_path(.., true)` runs.
    assert!(!dir.join(".omniterm").exists());
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn composite_workspace_rejects_connections_targeting_an_unknown_folder() {
    let workspace = Workspace {
        id: "ws#1".to_string(),
        name: "Composite".to_string(),
        folders: vec![
            WorkspaceFolder { id: "folder#1".to_string(), name: "One".to_string(), path: "/one".to_string() },
            WorkspaceFolder { id: "folder#2".to_string(), name: "Two".to_string(), path: "/two".to_string() },
        ],
        parent_id: None,
        order: 0,
        pins: Vec::new(),
    };
    let mut connection = conn("c1", "SSH");
    connection.parent_id = Some("folder#missing/src".to_string());
    let error = validate_connection_targets(&workspace, &[connection]).expect_err("unknown folder must fail");
    assert!(error.contains("unknown workspace folder"), "{error}");
}
