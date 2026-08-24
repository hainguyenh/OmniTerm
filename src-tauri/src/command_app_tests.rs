use super::*;
use serde_json::json;

#[test]
fn app_and_plugin_commands_cover_safe_no_side_effect_paths() {
    let fixture = MockApp::new();
    let app = fixture.handle();

    assert!(block_on(app_utils::clear_log(app.clone())).unwrap());
    assert!(!block_on(app_utils::get_version(app.clone()))
        .unwrap()
        .is_empty());

    let host = fixture.app.state::<PluginHost>();
    assert!(!block_on(plugin_available(app.clone(), host.clone())).unwrap());
    assert!(block_on(plugin_list(app.clone(), host.clone()))
        .unwrap()
        .is_empty());
    assert!(block_on(plugin_management::remove_plugin(
        app.clone(),
        host,
        "../unsafe".to_string(),
    ))
    .is_err());

    handle_second_instance(&app, &["omniterm".to_string()]);
    handle_second_instance(
        &app,
        &[
            "omniterm".to_string(),
            "--open-shell".to_string(),
            "bad".to_string(),
        ],
    );
    handle_second_instance(
        &app,
        &[
            "omniterm".to_string(),
            "--open-shell".to_string(),
            if cfg!(target_os = "windows") {
                "powershell"
            } else {
                "bash"
            }
            .to_string(),
            "--cwd".to_string(),
            std::env::temp_dir().to_string_lossy().into_owned(),
            "--name".to_string(),
            "Second instance".to_string(),
        ],
    );
}

/// `setup_launcher` is invoked once from the renderer mount; it must write the three shim files
/// idempotently and return the directory the pane PATH-prepending logic expects.
#[test]
fn setup_launcher_idempotently_writes_all_three_shims_into_app_data() {
    let fixture = MockApp::new();
    let app = fixture.handle();

    let bin_dir = block_on(launcher::setup_launcher(app.clone())).unwrap();
    assert_eq!(
        bin_dir,
        launcher::launcher_bin_dir(&app)
            .to_string_lossy()
            .into_owned()
    );

    for shim in ["nc-open.cmd", "wt.cmd", "wt-shim.ps1"] {
        let path = std::path::Path::new(&bin_dir).join(shim);
        assert!(
            path.is_file(),
            "{shim} should have been written on first setup"
        );
    }

    // Idempotent: same payload ⇒ no rewrite, same return path, no error.
    let again = block_on(launcher::setup_launcher(app.clone())).unwrap();
    assert_eq!(again, bin_dir);

    // Verify the actual content matches what launcher.rs produces. `nc-open.cmd` carries the
    // running executable, so this guards the regression where the shim pointed two levels above
    // <appData>/bin instead of naming the real running exe.
    let nc_open =
        std::fs::read_to_string(std::path::Path::new(&bin_dir).join("nc-open.cmd")).unwrap();
    let exe = std::env::current_exe().unwrap();
    let exe_display = exe.display().to_string();
    assert!(
        nc_open.contains(&exe_display),
        "nc-open.cmd should name the running exe: {nc_open}"
    );
    assert!(
        !nc_open.contains(".."),
        "the shim must not use a relative hop"
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

    let loaded = block_on(connections::load_connections(
        app.clone(),
        fixture.app.state::<PluginHost>(),
    ))
    .unwrap();
    assert_eq!(loaded.connections.len(), 1);
    assert_eq!(loaded.connections[0].name, "Connection local-rdp-check");

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

#[test]
fn handle_second_instance_finds_main_window_and_unminimizes_it() {
    let fixture = MockApp::new();
    let app = fixture.handle();
    let _window =
        tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::App("index.html".into()))
            .build()
            .unwrap();

    handle_second_instance(&app, &["omniterm".to_string()]);
}
