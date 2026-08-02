use super::*;
use serde_json::json;

#[test]
fn app_plugin_and_update_commands_cover_safe_no_side_effect_paths() {
    let fixture = MockApp::new();
    let app = fixture.handle();

    assert!(!block_on(app_utils::open_external("file:///tmp/bad".to_string())).unwrap());
    assert!(!block_on(app_utils::open_external(
        "https://example.test/help".to_string(),
    ))
    .unwrap());
    assert!(block_on(app_utils::clear_log(app.clone())).unwrap());
    assert!(!block_on(app_utils::get_version(app.clone())).unwrap().is_empty());
    assert!(!block_on(app_utils::get_platform()).unwrap().is_empty());
    assert!(!block_on(app_utils::get_home_dir()).unwrap().is_empty());
    assert!(block_on(app_utils::cleanup_rdp_cert()).unwrap());

    let host = fixture.app.state::<PluginHost>();
    assert!(!block_on(plugin_available(app.clone(), host.clone())).unwrap());
    assert!(block_on(plugin_list(app.clone(), host.clone())).unwrap().is_empty());
    assert!(block_on(plugin_management::remove_plugin(
        app.clone(),
        host,
        "../unsafe".to_string(),
    ))
    .is_err());

    assert_eq!(block_on(check_updates()).unwrap(), json!(null));
    assert_eq!(block_on(get_update_state()).unwrap(), json!(null));
    block_on(skip_version(None)).unwrap();
    block_on(skip_version(Some("1.2.3".to_string()))).unwrap();

    handle_second_instance(&app, &["omniterm".to_string()]);
    handle_second_instance(
        &app,
        &[
            "omniterm".to_string(),
            "--open-shell".to_string(),
            "bad".to_string(),
        ],
    );
}


#[test]
fn plugin_command_wrappers_preserve_stopped_host_fallbacks_and_errors() {
    let fixture = MockApp::new();
    let host = fixture.app.state::<PluginHost>();

    assert_eq!(
        block_on(connection_provider_capabilities(host.clone())).unwrap(),
        None
    );
    assert!(block_on(plugin_auth_gate(host.clone())).unwrap());
    assert!(block_on(plugin_set_enabled(
        host.clone(),
        "missing".to_string(),
        true,
    ))
    .is_err());
    assert!(block_on(plugin_select_connection_provider(
        host.clone(),
        Some("missing".to_string()),
    ))
    .is_err());
    assert!(block_on(plugin_invoke(
        host,
        "missing.method".to_string(),
        vec![json!({"covered": true})],
    ))
    .is_err());
}


#[test]
fn rdp_commands_reject_non_rdp_connections_and_cleanup_registered_files() {
    let fixture = MockApp::new();
    let app = fixture.handle();
    let mut local = connection("local-rdp-check");
    local.conn_type = "LOCAL".to_string();
    local.shell = Some(if cfg!(target_os = "windows") {
        "powershell".to_string()
    } else {
        "bash".to_string()
    });
    local.host.clear();
    local.port.clear();
    local.user.clear();

    block_on(connections::save_connections(
        app.clone(),
        fixture.app.state::<PluginHost>(),
        connections::ConnectionTree {
            connections: vec![local],
            folders: vec![],
        },
    ))
    .unwrap();
    assert_eq!(
        block_on(rdp_embed::connect_rdp(
            app.clone(),
            "local-rdp-check".to_string(),
        ))
        .unwrap_err(),
        "Not an RDP connection."
    );
    assert!(block_on(rdp_embed::connect_rdp(
        app.clone(),
        "missing-rdp".to_string(),
    ))
    .is_err());

    let temp = fixture.data_dir.join("coverage.rdp");
    write_file(&temp, b"coverage");
    fixture
        .app
        .state::<RdpSessionManager>()
        .register("rdp-covered".to_string(), temp.clone());
    block_on(rdp_embed::rdp_disconnect(
        app.clone(),
        "rdp-covered".to_string(),
    ))
    .unwrap();
    assert!(!temp.exists());
    block_on(rdp_embed::rdp_disconnect(app, "missing".to_string())).unwrap();
}
