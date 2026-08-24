//! Save/load round trip for the local connection tree. 
use super::*;
#[test]
fn test_save_and_load_connections() {
    use tauri::Manager;
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    let handle = app.handle().clone();
    assert!(app.manage(crate::plugin_host::PluginHost::new()));
    let host = app.state::<crate::plugin_host::PluginHost>();

    let tree = ConnectionTree {
        folders: vec![Folder {
            id: "f1".into(),
            name: "Folder 1".into(),
            parent_id: None,
        }],
        connections: vec![Connection {
            id: "c1".into(),
            name: "Server 1".into(),
            conn_type: "SSH".into(),
            host: "10.0.0.1".into(),
            port: "22".into(),
            user: "root".into(),
            password_help_url: None,
            parent_id: Some("f1".into()),
            redirect_drives: None,
            shell: None,
            local_args: None,
            local_cwd: None,
            local_command: None,
            local_keep_open: None,
        }],
    };

    let save_res = tauri::async_runtime::block_on(save_connections(handle.clone(), host, tree));
    assert!(save_res.is_ok());

    let host2 = app.state::<crate::plugin_host::PluginHost>();
    let loaded = tauri::async_runtime::block_on(load_connections(handle.clone(), host2)).unwrap();
    assert_eq!(loaded.connections.len(), 1);
    assert_eq!(loaded.folders.len(), 1);

    if let Ok(path) = connections_path(app.handle()) {
        let _ = std::fs::remove_file(path);
    }
}
