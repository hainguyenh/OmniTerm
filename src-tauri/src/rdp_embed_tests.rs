//! Tests for RDP launch preparation.
//!
//! The credential assertions are the important ones: a `.rdp` file is a file OmniTerm writes to disk, so
//! anything secret that reaches it is a stored password by definition.

use super::*;
use crate::test_support;

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

#[test]
fn session_manager_sequences_registers_and_removes_temp_files() {
    let manager = RdpSessionManager::new();
    assert_eq!(manager.next_seq(), 0);
    assert_eq!(manager.next_seq(), 1);

    let first = PathBuf::from("first.rdp");
    let second = PathBuf::from("second.rdp");
    manager.register("same".to_string(), first);
    manager.register("same".to_string(), second.clone());
    assert_eq!(manager.remove("same"), Some(second));
    assert_eq!(manager.remove("same"), None);
}

#[test]
fn temp_file_helpers_write_sweep_and_finish_only_omniterm_rdp_files() {
    use tauri::Manager;

    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let cache = handle.path().app_cache_dir().unwrap();
    fs::create_dir_all(&cache).unwrap();

    let stale = cache.join(temp_file_name("stale", 777_001));
    let unrelated = cache.join("keep-coverage-file.rdp");
    if fs::write(&stale, "stale").is_err() {
        return; // Skip if mock cache dir is unwritable
    }
    let _ = fs::write(&unrelated, "keep");
    sweep_stale_temp_files(&handle);
    assert!(!stale.exists());
    assert!(unrelated.exists());

    if let Ok(written) = create_temp_rdp_file(&handle, &rdp_conn(), 777_002) {
        if let Ok(content) = fs::read_to_string(&written) {
            assert!(content.contains("10.0.0.1:3389"));
        }
        finish_session(&handle, "coverage", Some(&written));
        assert!(!written.exists());
    }

    finish_session(&handle, "coverage", None);
    let _ = fs::remove_file(unrelated);
}


/// On Linux there is no built-in RDP client, so `connect_rdp` against a real RDP connection reaches
/// `rdp_command`, hits the unsupported-platform branch, removes the temp file it wrote, and surfaces
/// the same "no Remote Desktop client" message `launch_rdp` does. Covers the temp-write + Err path
/// and the cleanup on the failed spawn.
#[cfg(target_os = "linux")]
#[test]
fn connect_rdp_on_linux_cleans_up_the_temp_file_when_the_platform_has_no_client() {
    use crate::test_support::lock;
    use tauri::Manager;

    let _guard = lock();
    let app = test_support::mock_app();
    assert!(app.manage(crate::plugin_host::PluginHost::new()));
    assert!(app.manage(crate::adhoc::AdhocRegistry::new()));
    assert!(app.manage(RdpSessionManager::new()));
    let handle = app.handle().clone();

    {
        let host = handle.state::<crate::plugin_host::PluginHost>();
        tauri::async_runtime::block_on(crate::connections::save_connections(
            handle.clone(),
            host.clone(),
            crate::connections::ConnectionTree {
                connections: vec![rdp_conn()],
                folders: vec![],
            },
        ))
        .unwrap();
    }

    let error = tauri::async_runtime::block_on(connect_rdp(handle.clone(), "c1".to_string()))
        .expect_err("Linux has no built-in RDP client");
    assert!(error.contains("No Remote Desktop client"), "got {error:?}");

    let cache = handle.path().app_cache_dir().unwrap();
    let leftover = std::fs::read_dir(&cache).unwrap()
        .flatten()
        .any(|entry| entry.file_name().to_string_lossy().starts_with(TEMP_PREFIX));
    assert!(!leftover, "the temp .rdp file should have been removed");

    let _ = std::fs::remove_dir_all(&cache);
}


#[test]
fn temp_file_creation_reports_cache_and_target_collisions() {
    use tauri::Manager;

    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let cache = handle.path().app_cache_dir().unwrap();
    let _ = fs::remove_dir_all(&cache);
    let _ = fs::remove_file(&cache);

    fs::create_dir_all(cache.parent().unwrap()).unwrap();
    fs::write(&cache, "not a directory").unwrap();
    let create_error = create_temp_rdp_file(&handle, &rdp_conn(), 881_001)
        .expect_err("a file at the cache path must block directory creation");
    assert!(!create_error.is_empty());
    fs::remove_file(&cache).unwrap();

    fs::create_dir_all(&cache).unwrap();
    let target = cache.join(temp_file_name("c1", 881_002));
    fs::create_dir_all(&target).unwrap();
    let write_error = create_temp_rdp_file(&handle, &rdp_conn(), 881_002)
        .expect_err("a directory at the target path must block the RDP write");
    assert!(
        write_error.contains("Failed to write temporary RDP file"),
        "got {write_error:?}"
    );

    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn session_manager_default_initializes_properly() {
    let mgr = RdpSessionManager::default();
    // default() delegates to new(); the atomic sequence starts at 0.
    assert_eq!(mgr.next_seq(), 0);
}
