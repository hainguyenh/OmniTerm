//! Tests for saving and deleting workspace connection profiles.

use super::*;
use std::path::Path;

fn draft(conn_type: &str, host: &str) -> Connection {
    Connection {
        id: String::new(),
        name: String::new(),
        conn_type: conn_type.to_string(),
        host: host.to_string(),
        port: String::new(),
        user: String::new(),
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

fn folder() -> tempfile::TempDir {
    tempfile::tempdir().expect("temp folder")
}

fn path_of(dir: &tempfile::TempDir) -> String {
    dir.path().to_string_lossy().into_owned()
}

fn file_text(dir: &Path) -> String {
    fs::read_to_string(dir.join(".omniterm").join("connections.json")).expect("connections file")
}

#[test]
fn a_new_profile_gets_an_id_and_a_name_from_its_address() {
    let saved = validated(Connection {
        user: " root ".to_string(),
        port: "2222".to_string(),
        ..draft("ssh", " 10.0.0.5 ")
    })
    .expect("valid profile");
    assert!(saved.id.starts_with("conn-"));
    assert_eq!(saved.conn_type, "SSH");
    assert_eq!(saved.name, "root@10.0.0.5");
    assert_eq!(saved.host, "10.0.0.5");
    assert_eq!(saved.port, "2222");
}

#[test]
fn rejects_what_ssh_or_mstsc_would_misread() {
    assert!(validated(draft("LOCAL", "h")).is_err());
    assert!(validated(draft("SSH", "")).is_err());
    assert!(validated(draft("SSH", "-oProxyCommand=calc")).is_err());
    assert!(validated(draft("SSH", "two words")).is_err());
    assert!(validated(Connection {
        user: "-l".to_string(),
        ..draft("SSH", "h")
    })
    .is_err());
    assert!(validated(Connection {
        port: "0".to_string(),
        ..draft("SSH", "h")
    })
    .is_err());
    assert!(validated(Connection {
        port: "70000".to_string(),
        ..draft("RDP", "h")
    })
    .is_err());
}

#[test]
fn keeps_redirect_drives_for_remote_desktop_only_and_drops_local_fields() {
    let rdp = validated(Connection {
        redirect_drives: Some(true),
        ..draft("RDP", "pc")
    })
    .expect("rdp");
    assert_eq!(rdp.redirect_drives, Some(true));
    let ssh = validated(Connection {
        redirect_drives: Some(true),
        local_command: Some("evil".to_string()),
        ..draft("SSH", "h")
    })
    .expect("ssh");
    assert_eq!(ssh.redirect_drives, None);
    assert_eq!(ssh.local_command, None);
}

#[test]
fn saves_new_profiles_to_the_first_folder_and_never_a_password() {
    let first = folder();
    let second = folder();
    let folders = vec![path_of(&first), path_of(&second)];
    let saved =
        upsert_in(&folders, validated(draft("SSH", "host")).expect("valid")).expect("saved");
    let stored = read_at(&folders[0]).expect("read back");
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].id, saved.id);
    assert!(read_at(&folders[1]).expect("second").is_empty());
    assert!(!file_text(first.path()).contains("password"));
}

#[test]
fn updates_a_profile_in_the_folder_that_holds_it_keeping_its_parent() {
    let first = folder();
    let second = folder();
    let folders = vec![path_of(&first), path_of(&second)];
    let existing = Connection {
        id: "c1".to_string(),
        parent_id: Some("group".to_string()),
        ..draft("SSH", "old")
    };
    let omniterm = second.path().join(".omniterm");
    fs::create_dir_all(&omniterm).expect("dir");
    let json = serde_json::to_string(&WorkspaceConnectionsFile {
        connections: vec![existing],
    })
    .expect("json");
    fs::write(omniterm.join("connections.json"), json).expect("write");

    let edited = validated(Connection {
        id: "c1".to_string(),
        ..draft("SSH", "new")
    })
    .expect("valid");
    upsert_in(&folders, edited).expect("saved");
    let stored = read_at(&folders[1]).expect("read back");
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].host, "new");
    assert_eq!(stored[0].parent_id.as_deref(), Some("group"));
    assert!(read_at(&folders[0]).expect("first").is_empty());
}

#[test]
fn deletes_a_profile_and_reports_a_missing_one() {
    let only = folder();
    let folders = vec![path_of(&only)];
    let saved = upsert_in(&folders, validated(draft("RDP", "pc")).expect("valid")).expect("saved");
    assert!(remove_from(&folders, &saved.id).expect("removed"));
    assert!(read_at(&folders[0]).expect("read back").is_empty());
    assert!(!remove_from(&folders, &saved.id).expect("second remove"));
}

#[test]
fn a_workspace_without_folders_cannot_save() {
    assert!(upsert_in(&[], validated(draft("SSH", "h")).expect("valid")).is_err());
}
