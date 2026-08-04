#![allow(unused_imports)]
#![allow(dead_code)]

use super::*;
use crate::connections::{self, Connection, ConnectionTree};
use crate::plugin_host::PluginHost;
use tauri::Manager;

fn ssh(id: &str, user: &str, port: &str) -> Connection {
    Connection {
        id: id.into(),
        name: format!("SSH {id}"),
        conn_type: "SSH".into(),
        host: "ssh.example.test".into(),
        port: port.into(),
        user: user.into(),
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

#[cfg(not(target_os = "windows"))]
#[test]
fn valid_ssh_profiles_reach_the_platform_client_boundary() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    assert!(app.manage(AdhocRegistry::new()));
    assert!(app.manage(PluginHost::new()));
    let handle = app.handle().clone();
    let data_dir = handle.path().app_data_dir().unwrap();
    let _ = std::fs::remove_dir_all(&data_dir);

    for connection in [
        ssh("default-port", "", ""),
        ssh("explicit-port", "operator", "2222"),
    ] {
        let id = connection.id.clone();
        tauri::async_runtime::block_on(connections::save_connections(
            handle.clone(),
            app.state::<PluginHost>(),
            ConnectionTree {
                connections: vec![connection],
                folders: vec![],
            },
        ))
        .unwrap();
        let error = tauri::async_runtime::block_on(prepare_ssh_session(
            handle.clone(),
            id,
        ))
        .unwrap_err();
        assert_eq!(error, "ssh.exe is available only on Windows.");
    }
    let _ = std::fs::remove_dir_all(data_dir);
}
