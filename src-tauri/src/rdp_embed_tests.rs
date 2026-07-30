//! Tests for RDP launch preparation.
//!
//! The credential assertions are the important ones: a `.rdp` file is a file OmniTerm writes to disk, so
//! anything secret that reaches it is a stored password by definition.

use super::*;

fn rdp_conn() -> Connection {
    Connection {
        id: "c1".to_string(),
        name: "Server 1".to_string(),
        conn_type: "RDP".to_string(),
        host: "10.0.0.1".to_string(),
        port: "3389".to_string(),
        user: "admin".to_string(),
        password_help_url: None,
        parent_id: None,
        redirect_drives: Some(true),
        shell: None,
        local_args: None,
        local_cwd: None,
        local_command: None,
        local_keep_open: None,
    }
}

#[test]
fn rdp_content_generation_includes_host_port_user() {
    let content = generate_rdp_content(&rdp_conn());
    assert!(content.contains("full address:s:10.0.0.1:3389"));
    assert!(content.contains("username:s:admin"));
    assert!(content.contains("redirectdrives:i:1"));
}

#[test]
fn an_empty_port_falls_back_to_3389() {
    let mut conn = rdp_conn();
    conn.port = String::new();
    assert!(generate_rdp_content(&conn).contains("full address:s:10.0.0.1:3389"));
}

/// The file must never carry a credential, in any of the forms `mstsc` understands. `Connection` has no
/// password field, so this is a guard against someone adding one and threading it through here.
#[test]
fn the_rdp_file_contains_no_credential_directive() {
    let content = generate_rdp_content(&rdp_conn()).to_lowercase();
    for forbidden in [
        "password 51:b:",
        "password:",
        "prompt for credentials",
        "promptcredentialonce",
        "clearpassword",
    ] {
        assert!(
            !content.contains(forbidden),
            "generated .rdp must not contain {forbidden}"
        );
    }
    // Only the directives we intend, one per line.
    for line in content.lines().filter(|l| !l.is_empty()) {
        assert!(line.contains(':'), "unexpected line {line:?}");
    }
}

/// Two panes on one connection used to share a single temp path, so disconnecting either deleted the
/// file the other was registered under.
#[test]
fn concurrent_sessions_to_one_connection_get_distinct_files() {
    let a = temp_file_name("c1", 0);
    let b = temp_file_name("c1", 1);
    assert_ne!(a, b);
    assert!(a.starts_with(TEMP_PREFIX) && a.ends_with(".rdp"));
    assert!(b.starts_with(TEMP_PREFIX) && b.ends_with(".rdp"));
}

/// The id reaches this from a saved connection, but it names a file — so path separators and traversal
/// segments must not survive into the name.
#[test]
fn the_temp_name_cannot_escape_its_directory() {
    for id in [
        "../../etc/passwd",
        r"..\..\windows\system32",
        "a/b/c",
        "with spaces",
        "sem;colon",
    ] {
        let name = temp_file_name(id, 0);
        assert!(!name.contains('/'), "{name} must not contain /");
        assert!(!name.contains('\\'), "{name} must not contain a backslash");
        assert!(!name.contains(".."), "{name} must not contain ..");
        assert_eq!(Path::new(&name).file_name().unwrap(), name.as_str());
    }
}

/// The sweep must match what the writer produces, or stale files accumulate forever.
#[test]
fn the_sweep_prefix_matches_what_is_written() {
    assert!(temp_file_name("anything", 7).starts_with(TEMP_PREFIX));
}
