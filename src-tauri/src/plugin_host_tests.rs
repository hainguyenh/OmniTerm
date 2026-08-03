use super::*;
use std::fs;
use tempfile::TempDir;
use tauri::Manager;

use crate::test_support;

fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

#[test]
fn installed_plugin_detection_requires_a_child_package_manifest() {
    let root = TempDir::new().unwrap();
    assert!(!contains_installed_plugin(root.path()));
    fs::write(root.path().join("package.json"), "{}").unwrap();
    assert!(!contains_installed_plugin(root.path()));
    fs::create_dir_all(root.path().join("plugin-a")).unwrap();
    fs::write(root.path().join("plugin-a/package.json"), "{}").unwrap();
    assert!(contains_installed_plugin(root.path()));
}

#[test]
fn development_plugin_directory_uses_only_an_existing_explicit_path() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let original = std::env::var_os("OMNITERM_DEV_PLUGIN");
    let plugin = TempDir::new().unwrap();

    std::env::set_var("OMNITERM_DEV_PLUGIN", plugin.path());
    assert_eq!(bundled_plugin_dir(&handle), Some(plugin.path().to_path_buf()));
    std::env::set_var("OMNITERM_DEV_PLUGIN", plugin.path().join("missing"));
    assert_ne!(bundled_plugin_dir(&handle), Some(plugin.path().join("missing")));

    match original {
        Some(value) => std::env::set_var("OMNITERM_DEV_PLUGIN", value),
        None => std::env::remove_var("OMNITERM_DEV_PLUGIN"),
    }
}

#[test]
fn source_sidecar_resolves_in_debug_and_plugin_free_start_is_silent() {
    let _guard = test_support::lock();
    let original_plugin = std::env::var_os("OMNITERM_DEV_PLUGIN");
    std::env::remove_var("OMNITERM_DEV_PLUGIN");
    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let data = handle.path().app_data_dir().unwrap();
    let _ = fs::remove_dir_all(data.join("plugins"));

    assert!(resolve_sidecar_script(&handle).is_some());
    let host = PluginHost::new();
    block_on(host.start(&handle)).unwrap();
    assert!(!host.started.load(Ordering::SeqCst));
    assert!(block_on(host.list_plugins()).unwrap().is_empty());

    match original_plugin {
        Some(value) => std::env::set_var("OMNITERM_DEV_PLUGIN", value),
        None => std::env::remove_var("OMNITERM_DEV_PLUGIN"),
    }
}

#[test]
fn startup_failure_records_a_visible_disabled_reason() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let plugins = handle.path().app_data_dir().unwrap().join("plugins/demo");
    fs::create_dir_all(&plugins).unwrap();
    fs::write(plugins.join("package.json"), "{}").unwrap();

    let original_path = std::env::var_os("PATH");
    let original_plugin = std::env::var_os("OMNITERM_DEV_PLUGIN");
    std::env::remove_var("OMNITERM_DEV_PLUGIN");
    std::env::set_var("PATH", "");
    let host = PluginHost::new();
    block_on(host.start(&handle)).unwrap();
    let descriptors = block_on(host.list_plugins()).unwrap();
    assert_eq!(descriptors.len(), 1);
    assert!(descriptors[0]["error"].as_str().unwrap().contains("Could not start"));

    match original_path {
        Some(value) => std::env::set_var("PATH", value),
        None => std::env::remove_var("PATH"),
    }
    match original_plugin {
        Some(value) => std::env::set_var("OMNITERM_DEV_PLUGIN", value),
        None => std::env::remove_var("OMNITERM_DEV_PLUGIN"),
    }
    let _ = fs::remove_dir_all(handle.path().app_data_dir().unwrap().join("plugins"));
}

#[test]
fn already_started_host_returns_without_touching_the_transport() {
    let app = test_support::mock_app();
    let host = PluginHost::new();
    host.started.store(true, Ordering::SeqCst);
    block_on(host.start(app.handle())).unwrap();
    assert!(host.started.load(Ordering::SeqCst));
}
