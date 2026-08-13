//! Cross-module provider integration through the real `PluginHost::call` transport.

use super::*;
use crate::connections::{Connection, ConnectionTree};
use crate::{connections, pty_resolve, workspace, workspace_connections};
use std::fs;
use tauri::Manager;

fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

fn connection(id: &str) -> Connection {
    Connection {
        id: id.into(),
        name: format!("provider {id}"),
        conn_type: "SSH".into(),
        host: "provider.test".into(),
        port: "22".into(),
        user: "operator".into(),
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

struct ProviderPaths {
    personal: String,
    workspace: String,
    non_bat: String,
    outside: String,
    missing: String,
}

fn start_provider(host: &PluginHost, paths: ProviderPaths, malformed_loads: bool) {
    host.started.store(true, Ordering::SeqCst);
    let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(32);
    block_on(async { *host.stdin_tx.lock().await = Some(stdin_tx) });
    let pending = Arc::clone(&host.pending);
    tauri::async_runtime::spawn(async move {
        while let Some(line) = stdin_rx.recv().await {
            let request: Value = serde_json::from_str(&line).unwrap();
            let id = request["id"].as_u64().unwrap();
            let params = &request["params"];
            let result = match request["method"].as_str().unwrap() {
                "plugin.available" => json!(true),
                "plugin.list" => json!([{"id":"provider.test","enabled":true}]),
                "plugin.setEnabled" => json!({
                    "id": params["id"].clone(), "enabled": params["enabled"].clone()
                }),
                "plugin.selectConnectionProvider" => json!([{"id":params["id"].clone()}]),
                "connections.capabilities" => json!({"protocols":["SSH"]}),
                "plugin.invoke" => json!({
                    "method": params["method"].clone(), "args": params["args"].clone()
                }),
                "plugin.authGate" => json!(false),
                "plugin.uninstall" => json!(true),
                "connections.load" => if malformed_loads {
                    json!("invalid tree")
                } else {
                    json!({"connections": [connection("remote-global")], "folders": []})
                },
                "connections.save" | "connections.saveScoped" => json!(!malformed_loads),
                "connections.loadScoped" => if malformed_loads {
                    json!("invalid tree")
                } else {
                    json!({
                        "connections": [connection("remote-workspace"), connection("remove-me")],
                        "folders": []
                    })
                },
                "connections.resolveScoped" => match params["connId"].as_str() {
                    Some("scoped-provider") => json!(connection("scoped-provider")),
                    _ => Value::Null,
                },
                "connections.resolve" => match params["connId"].as_str() {
                    Some("personal-provider") => json!(connection("personal-provider")),
                    _ => Value::Null,
                },
                "connections.resolveLaunch" => {
                    let conn_id = params["connId"].as_str().unwrap_or_default();
                    let workspace_scope = params["scope"]["kind"] == "workspace";
                    match conn_id {
                        "batch-good" => json!({"kind":"batch","presentation":"terminal","path":&paths.personal}),
                        "batch-kind" => json!({"kind":"native","presentation":"terminal","path":&paths.personal}),
                        "batch-mismatch" => json!({"kind":"batch","presentation":"window","path":&paths.personal}),
                        "batch-danger" => json!({"kind":"batch","presentation":"terminal","path":"bad&launcher.bat"}),
                        "batch-no-path" => json!({"kind":"batch","presentation":"terminal"}),
                        "batch-missing" => json!({"kind":"batch","presentation":"terminal","path":&paths.missing}),
                        "batch-non-bat" => json!({"kind":"batch","presentation":"terminal","path":&paths.non_bat}),
                        "batch-outside" => json!({"kind":"batch","presentation":"terminal","path":&paths.outside}),
                        "batch-no-root" => json!({"kind":"batch","presentation":"terminal","path":&paths.outside}),
                        "workspace-batch" if workspace_scope => json!({
                            "kind":"batch","presentation":"terminal","path":&paths.workspace
                        }),
                        _ => Value::Null,
                    }
                }
                _ => Value::Null,
            };
            if let Some((_, tx)) = pending.remove(&id) {
                let _ = tx.send(Ok(result));
            }
        }
    });
}

fn setup() -> (tauri::App<tauri::test::MockRuntime>, tempfile::TempDir, ProviderPaths) {
    let app = crate::test_support::mock_app();
    assert!(app.manage(crate::adhoc::AdhocRegistry::new()));
    assert!(app.manage(PluginHost::new()));
    let workspace_root = tempfile::tempdir().unwrap();
    let data = app.path().app_data_dir().unwrap();
    let _ = fs::remove_dir_all(&data);
    let personal_dir = data.join("plugin-storage");
    let workspace_dir = workspace_root.path().join(".omniterm/launchers");
    fs::create_dir_all(&personal_dir).unwrap();
    fs::create_dir_all(&workspace_dir).unwrap();
    let personal = personal_dir.join("personal.bat");
    let workspace = workspace_dir.join("workspace.bat");
    let non_bat = personal_dir.join("launcher.txt");
    let outside = workspace_root.path().join("outside.bat");
    for path in [&personal, &workspace, &non_bat, &outside] {
        fs::write(path, "@echo off\n").unwrap();
    }
    let paths = ProviderPaths {
        personal: personal.to_string_lossy().into_owned(),
        workspace: workspace.to_string_lossy().into_owned(),
        non_bat: non_bat.to_string_lossy().into_owned(),
        outside: outside.to_string_lossy().into_owned(),
        missing: personal_dir.join("missing.bat").to_string_lossy().into_owned(),
    };
    (app, workspace_root, paths)
}

#[test]
fn provider_data_drives_global_workspace_and_resolution_fallbacks() {
    let _guard = crate::test_support::lock();
    let (app, workspace_root, paths) = setup();
    let handle = app.handle().clone();
    let workspace = block_on(workspace::add_workspace(
        handle.clone(),
        workspace_root.path().to_string_lossy().into_owned(),
    ))
    .unwrap();
    let host = app.state::<PluginHost>();
    start_provider(host.inner(), paths, false);

    let global = block_on(connections::load_connections(handle.clone(), host.clone())).unwrap();
    assert_eq!(global.connections[0].id, "remote-global");
    block_on(connections::save_connections(
        handle.clone(),
        host.clone(),
        ConnectionTree { connections: vec![connection("saved")], folders: vec![] },
    ))
    .unwrap();
    assert!(!connections::connections_path(&handle).unwrap().exists());

    let scoped = block_on(workspace_connections::load_workspace_connections(
        handle.clone(), host.clone(), workspace.id.clone(),
    ))
    .unwrap();
    assert_eq!(scoped.len(), 2);
    block_on(workspace_connections::save_workspace_connections(
        handle.clone(), host.clone(), workspace.id.clone(), vec![connection("saved-scoped")],
    ))
    .unwrap();
    block_on(workspace_connections::delete_workspace_connection(
        handle.clone(), host.clone(), workspace.id, "remove-me".into(),
    ))
    .unwrap();
    assert!(!workspace_root.path().join(".omniterm/connections.json").exists());

    assert_eq!(
        block_on(pty_resolve::resolve_connection_by_id(&handle, "scoped-provider"))
            .unwrap().id,
        "scoped-provider"
    );
    assert_eq!(
        block_on(pty_resolve::resolve_connection_by_id(&handle, "personal-provider"))
            .unwrap().id,
        "personal-provider"
    );
}

#[test]
fn provider_batch_launches_are_confined_and_schema_checked() {
    let _guard = crate::test_support::lock();
    let (app, workspace_root, paths) = setup();
    let handle = app.handle().clone();
    block_on(workspace::add_workspace(
        handle.clone(), workspace_root.path().to_string_lossy().into_owned(),
    ))
    .unwrap();
    start_provider(app.state::<PluginHost>().inner(), paths, false);

    assert!(block_on(pty_resolve::native_batch_launch(&handle, "batch-good", "terminal"))
        .unwrap().unwrap().ends_with("personal.bat"));
    assert_eq!(
        block_on(pty_resolve::native_batch_launch(&handle, "batch-mismatch", "terminal")).unwrap(),
        None
    );
    assert_eq!(
        block_on(pty_resolve::native_batch_launch(&handle, "batch-kind", "terminal")).unwrap(),
        None
    );
    assert!(block_on(pty_resolve::native_batch_launch(&handle, "workspace-batch", "terminal"))
        .unwrap().unwrap().ends_with("workspace.bat"));

    for (id, expected) in [
        ("batch-danger", "unsupported command characters"),
        ("batch-no-path", "invalid launcher path"),
        ("batch-missing", "launcher is missing"),
        ("batch-non-bat", "non-BAT launcher"),
        ("batch-outside", "outside its allowed directory"),
    ] {
        let error = block_on(pty_resolve::native_batch_launch(&handle, id, "terminal")).unwrap_err();
        assert!(error.contains(expected), "{id}: {error}");
    }

    fs::remove_dir_all(handle.path().app_data_dir().unwrap().join("plugin-storage")).unwrap();
    let error = block_on(pty_resolve::native_batch_launch(&handle, "batch-no-root", "terminal"))
        .unwrap_err();
    assert!(error.contains("launcher directory is unavailable"), "{error}");
}

#[test]
fn malformed_or_declined_provider_results_fall_back_to_local_files() {
    let _guard = crate::test_support::lock();
    let (app, workspace_root, paths) = setup();
    let handle = app.handle().clone();
    let workspace = block_on(workspace::add_workspace(
        handle.clone(),
        workspace_root.path().to_string_lossy().into_owned(),
    ))
    .unwrap();
    let host = app.state::<PluginHost>();

    block_on(connections::save_connections(
        handle.clone(),
        host.clone(),
        ConnectionTree { connections: vec![connection("disk-global")], folders: vec![] },
    ))
    .unwrap();
    block_on(workspace_connections::save_workspace_connections(
        handle.clone(),
        host.clone(),
        workspace.id.clone(),
        vec![connection("disk-workspace"), connection("delete-local")],
    ))
    .unwrap();

    start_provider(host.inner(), paths, true);
    assert_eq!(
        block_on(connections::load_connections(handle.clone(), host.clone()))
            .unwrap().connections[0].id,
        "disk-global"
    );
    block_on(connections::save_connections(
        handle.clone(),
        host.clone(),
        ConnectionTree { connections: vec![connection("disk-replaced")], folders: vec![] },
    ))
    .unwrap();
    assert_eq!(connections::read_tree(&handle).unwrap().connections[0].id, "disk-replaced");

    assert_eq!(
        block_on(workspace_connections::load_workspace_connections(
            handle.clone(), host.clone(), workspace.id.clone(),
        ))
        .unwrap()[0]
        .id,
        "disk-workspace"
    );
    block_on(workspace_connections::delete_workspace_connection(
        handle.clone(), host.clone(), workspace.id.clone(), "delete-local".into(),
    ))
    .unwrap();
    assert_eq!(workspace_connections::read_at(&workspace.folders[0].path).unwrap().len(), 1);
    block_on(workspace_connections::save_workspace_connections(
        handle, host, workspace.id, vec![connection("disk-scoped-replaced")],
    ))
    .unwrap();
    assert_eq!(workspace_connections::read_at(&workspace.folders[0].path).unwrap()[0].id, "disk-scoped-replaced");
}


#[test]
fn live_provider_covers_every_plugin_command_wrapper() {
    let _guard = crate::test_support::lock();
    let (app, _workspace_root, paths) = setup();
    let handle = app.handle().clone();
    let host = app.state::<PluginHost>();
    start_provider(host.inner(), paths, false);

    assert!(block_on(crate::plugin_available(handle.clone(), host.clone())).unwrap());
    assert_eq!(
        block_on(crate::plugin_list(handle, host.clone())).unwrap()[0]["id"],
        "provider.test"
    );
    assert_eq!(
        block_on(crate::plugin_set_enabled(
            host.clone(),
            "provider.test".into(),
            false,
        ))
        .unwrap()["enabled"],
        false
    );
    assert_eq!(
        block_on(crate::plugin_select_connection_provider(
            host.clone(),
            Some("provider.test".into()),
        ))
        .unwrap()[0]["id"],
        "provider.test"
    );
    assert_eq!(
        block_on(crate::connection_provider_capabilities(host.clone()))
            .unwrap()
            .unwrap()["protocols"][0],
        "SSH"
    );
    assert_eq!(
        block_on(crate::plugin_invoke(
            host.clone(),
            "provider.echo".into(),
            vec![json!(7)],
        ))
        .unwrap(),
        json!({"method":"provider.echo","args":[7]})
    );
    assert!(!block_on(crate::plugin_auth_gate(host.clone())).unwrap());
    assert!(block_on(host.uninstall("provider.test".into())).unwrap());
}
