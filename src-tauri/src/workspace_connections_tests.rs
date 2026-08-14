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
            WorkspaceFolder { id: "folder#1".to_string(), name: "One".to_string(), path: "/one".to_string(), color: None },
            WorkspaceFolder { id: "folder#2".to_string(), name: "Two".to_string(), path: "/two".to_string(), color: None },
        ],
        parent_id: None,
        order: 0,
        pins: Vec::new(),
        color: None,
        icon: None,
    };
    let mut connection = conn("c1", "SSH");
    connection.parent_id = Some("folder#missing/src".to_string());
    let error = validate_connection_targets(&workspace, &[connection]).expect_err("unknown folder must fail");
    assert!(error.contains("unknown workspace folder"), "{error}");

    let mut unparented = conn("c2", "SSH");
    unparented.parent_id = None;
    let err2 = validate_connection_targets(&workspace, &[unparented]).expect_err("multi-root requires folder");
    assert!(err2.contains("Choose a workspace folder"));

    let single_ws = Workspace {
        id: "ws#s".to_string(),
        name: "Single".to_string(),
        folders: vec![WorkspaceFolder { id: "f1".to_string(), name: "F1".to_string(), path: "/one".to_string(), color: None }],
        parent_id: None,
        order: 0,
        pins: Vec::new(),
        color: None,
        icon: None,
    };
    assert!(validate_connection_targets(&single_ws, &[conn("c3", "SSH")]).is_ok());
}

#[test]
fn local_connection_strips_folder_prefix_and_filters_unrelated_folders() {
    let folder1 = WorkspaceFolder { id: "f1".to_string(), name: "One".to_string(), path: "/one".to_string(), color: None };
    let folder2 = WorkspaceFolder { id: "f2".to_string(), name: "Two".to_string(), path: "/two".to_string(), color: None };
    let ws_multi = Workspace {
        id: "ws#m".to_string(),
        name: "Multi".to_string(),
        folders: vec![folder1.clone(), folder2.clone()],
        parent_id: None,
        order: 0,
        pins: Vec::new(),
        color: None,
        icon: None,
    };

    let mut c_f1_direct = conn("c1", "SSH");
    c_f1_direct.parent_id = Some("f1".to_string());
    let res1 = local_connection(&ws_multi, &folder1, c_f1_direct).unwrap().unwrap();
    assert_eq!(res1.parent_id, None);

    let mut c_f1_nested = conn("c2", "SSH");
    c_f1_nested.parent_id = Some("f1/servers".to_string());
    let res2 = local_connection(&ws_multi, &folder1, c_f1_nested).unwrap().unwrap();
    assert_eq!(res2.parent_id, Some("servers".to_string()));

    let mut c_f1_slash = conn("c3", "SSH");
    c_f1_slash.parent_id = Some("f1/".to_string());
    let res3 = local_connection(&ws_multi, &folder1, c_f1_slash).unwrap().unwrap();
    assert_eq!(res3.parent_id, None);

    let mut c_f2 = conn("c4", "SSH");
    c_f2.parent_id = Some("f2/nested".to_string());
    assert!(local_connection(&ws_multi, &folder1, c_f2).unwrap().is_none());

    let mut c_none = conn("c5", "SSH");
    c_none.parent_id = None;
    assert!(local_connection(&ws_multi, &folder1, c_none).unwrap().is_none());

    let ws_single = Workspace {
        id: "ws#s".to_string(),
        name: "Single".to_string(),
        folders: vec![folder1.clone()],
        parent_id: None,
        order: 0,
        pins: Vec::new(),
        color: None,
        icon: None,
    };
    let c_single_none = conn("c6", "SSH");
    let res_single = local_connection(&ws_single, &folder1, c_single_none.clone()).unwrap().unwrap();
    assert_eq!(res_single.parent_id, None);
    let res_other = local_connection(&ws_single, &folder2, c_single_none).unwrap();
    assert!(res_other.is_none());
}

#[test]
fn write_at_writes_valid_connections_and_find_by_id_locates_them() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let dir = temp_workspace();
    write_at(dir.to_str().unwrap(), vec![conn("ws-target-1", "SSH")]).expect("write_at");
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
