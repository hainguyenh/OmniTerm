//! Cross-module provider integration through the real `PluginHost::call` transport.

use super::*;
use crate::connections::Connection;
use std::fs;
use tauri::Manager;

pub(super) fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

pub(super) fn connection(id: &str) -> Connection {
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

pub(super) struct ProviderPaths {
    personal: String,
    workspace: String,
    non_bat: String,
    outside: String,
    missing: String,
}

pub(super) fn start_provider(host: &PluginHost, paths: ProviderPaths, malformed_loads: bool) {
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
                "connections.load" => {
                    if malformed_loads {
                        json!("invalid tree")
                    } else {
                        json!({"connections": [connection("remote-global")], "folders": []})
                    }
                }
                "connections.save" | "connections.saveScoped" => json!(!malformed_loads),
                "connections.loadScoped" => {
                    if malformed_loads {
                        json!("invalid tree")
                    } else {
                        json!({
                            "connections": [connection("remote-workspace"), connection("remove-me")],
                            "folders": []
                        })
                    }
                }
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
                        "batch-good" => {
                            json!({"kind":"batch","presentation":"terminal","path":&paths.personal})
                        }
                        "batch-kind" => {
                            json!({"kind":"native","presentation":"terminal","path":&paths.personal})
                        }
                        "batch-mismatch" => {
                            json!({"kind":"batch","presentation":"window","path":&paths.personal})
                        }
                        "batch-danger" => {
                            json!({"kind":"batch","presentation":"terminal","path":"bad&launcher.bat"})
                        }
                        "batch-no-path" => json!({"kind":"batch","presentation":"terminal"}),
                        "batch-missing" => {
                            json!({"kind":"batch","presentation":"terminal","path":&paths.missing})
                        }
                        "batch-non-bat" => {
                            json!({"kind":"batch","presentation":"terminal","path":&paths.non_bat})
                        }
                        "batch-outside" => {
                            json!({"kind":"batch","presentation":"terminal","path":&paths.outside})
                        }
                        "batch-no-root" => {
                            json!({"kind":"batch","presentation":"terminal","path":&paths.outside})
                        }
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

pub(super) fn setup() -> (
    tauri::App<tauri::test::MockRuntime>,
    tempfile::TempDir,
    ProviderPaths,
) {
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
        missing: personal_dir
            .join("missing.bat")
            .to_string_lossy()
            .into_owned(),
    };
    (app, workspace_root, paths)
}

