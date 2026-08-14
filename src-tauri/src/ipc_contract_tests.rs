//! End-to-end command contract tests.
//!
//! Direct unit tests cover command bodies, but Tauri also generates an IPC adapter for every
//! `#[tauri::command]`. These fixtures send the same JSON messages as the webview so command-name
//! registration, camel-case argument decoding, managed-state injection, async dispatch, and result
//! serialization are all exercised together.

use super::with_invoke_handler;
use crate::{
    adhoc::AdhocRegistry,
    plugin_host::PluginHost,
    pty::PtyManager,
    rdp_embed::RdpSessionManager,
    terminal_window::DetachRegistry,
};
use serde_json::Value;
use std::{fs, path::PathBuf, sync::MutexGuard};
use tauri::{test::MockRuntime, Manager};

#[path = "ipc_persistence_tests.rs"]
mod persistence;
#[cfg(target_os = "linux")]
#[path = "ipc_dialog_tests.rs"]
mod dialogs;
#[path = "ipc_runtime_tests.rs"]
mod runtime;
#[path = "ipc_workspace_tests.rs"]
mod workspace_ipc;
#[path = "ipc_workspace_edge_tests.rs"]
mod workspace_edges;

struct IpcApp {
    _guard: MutexGuard<'static, ()>,
    app: tauri::App<MockRuntime>,
    window: tauri::WebviewWindow<MockRuntime>,
    app_data_dir: PathBuf,
    app_cache_dir: PathBuf,
}

impl IpcApp {
    fn new() -> Self {
        let guard = crate::test_support::lock();
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().identifier = "com.omniterm.ipc-tests".to_string();

        let app = with_invoke_handler(
            tauri::test::mock_builder()
                .manage(PtyManager::new())
                .manage(AdhocRegistry::new())
                .manage(DetachRegistry::new())
                .manage(PluginHost::new())
                .manage(RdpSessionManager::new())
                .manage(crate::os_actions::ExternalLauncherState::test()),
        )
        .build(context)
        .expect("build IPC test app");
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("build IPC test window");
        let app_data_dir = app.path().app_data_dir().expect("app data dir");
        let app_cache_dir = app.path().app_cache_dir().expect("app cache dir");
        let _ = fs::remove_dir_all(&app_data_dir);
        let _ = fs::remove_dir_all(&app_cache_dir);

        Self {
            _guard: guard,
            app,
            window,
            app_data_dir,
            app_cache_dir,
        }
    }

    fn invoke(&self, command: &str, body: Value) -> Result<Value, Value> {
        tauri::test::get_ipc_response(
            &self.window,
            tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(any(windows, target_os = "android")) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .expect("valid IPC URL"),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .map(|response| {
            response
                .deserialize::<Value>()
                .expect("command response is JSON")
        })
    }

    fn ok(&self, command: &str, body: Value) -> Value {
        self.invoke(command, body)
            .unwrap_or_else(|error| panic!("{command} rejected: {error}"))
    }

    fn error(&self, command: &str, body: Value) -> Value {
        self.invoke(command, body)
            .expect_err("command should reject this request")
    }

    fn handle(&self) -> tauri::AppHandle<MockRuntime> {
        self.app.handle().clone()
    }
}

impl Drop for IpcApp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.app_data_dir);
        let _ = fs::remove_dir_all(&self.app_cache_dir);
    }
}

fn connection(id: &str) -> Value {
    serde_json::json!({
        "id": id,
        "name": format!("Connection {id}"),
        "type": "SSH",
        "host": "example.test",
        "port": "22",
        "user": "alice"
    })
}
