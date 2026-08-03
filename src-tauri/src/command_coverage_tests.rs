//! Command-level coverage using Tauri's real mock runtime.
//!
//! Pure helper tests do not catch command wiring: app-data path resolution, state lookup,
//! persistence, event emission, and provider fallbacks. These tests call the same functions
//! registered in `generate_handler!`; only commands that intentionally launch OS UI are omitted.

use super::*;
use crate::connections::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use crate::test_support;
use std::sync::MutexGuard;
use tauri::test::MockRuntime;
use tauri::Manager;

struct MockApp {
    _guard: MutexGuard<'static, ()>,
    app: tauri::App<MockRuntime>,
    data_dir: PathBuf,
}

impl MockApp {
    fn new() -> Self {
        let guard = test_support::lock();
        let app = test_support::mock_app();
        assert!(app.manage(AdhocRegistry::new()));
        assert!(app.manage(PluginHost::new()));
        assert!(app.manage(terminal_window::DetachRegistry::new()));
        assert!(app.manage(rdp_embed::RdpSessionManager::new()));
        assert!(app.manage(PtyManager::new()));
        let data_dir = app.path().app_data_dir().expect("mock app data directory");
        let _ = fs::remove_dir_all(&data_dir);
        Self {
            _guard: guard,
            app,
            data_dir,
        }
    }

    fn handle(&self) -> tauri::AppHandle<MockRuntime> {
        self.app.handle().clone()
    }
}

impl Drop for MockApp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.data_dir);
    }
}

fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

fn connection(id: &str) -> Connection {
    Connection {
        id: id.to_string(),
        name: format!("Connection {id}"),
        conn_type: "SSH".to_string(),
        host: "example.test".to_string(),
        port: "22".to_string(),
        user: "operator".to_string(),
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

fn write_file(path: impl AsRef<Path>, contents: impl AsRef<[u8]>) {
    let path = path.as_ref();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, contents).unwrap();
}

#[path = "command_persistence_tests.rs"]
mod persistence;
#[path = "command_workspace_tests.rs"]
mod workspace_commands;
#[path = "command_app_tests.rs"]
mod app_commands;
#[path = "command_connection_tests.rs"]
mod connection_commands;
