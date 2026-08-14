use super::*;
use std::fs;
use std::path::Path;
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
fn portable_resource_lookup_finds_sidecar_beside_executable() {
    let root = TempDir::new().unwrap();
    let executable = root.path().join("OmniTerm.exe");
    let sidecar = root.path().join("sidecar/plugin-host.cjs");
    fs::write(&executable, b"").unwrap();
    fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
    fs::write(&sidecar, b"").unwrap();

    assert_eq!(
        executable_adjacent_path_from(&executable, Path::new("sidecar/plugin-host.cjs")),
        Some(sidecar)
    );
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
    let _ = block_on(host.list_plugins());
}

#[test]
fn default_instantiates_unstarted_host() {
    use crate::plugin_host::PluginHost;
    let host = PluginHost::default();
    assert!(!block_on(host.is_available()));
}

#[test]
fn start_reports_an_app_data_path_that_cannot_be_created() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let data_dir = handle.path().app_data_dir().unwrap();
    let _ = fs::remove_dir_all(&data_dir);
    if let Some(parent) = data_dir.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&data_dir, b"not a directory").unwrap();

    let error = block_on(PluginHost::new().start(&handle)).unwrap_err();
    assert!(!error.is_empty());

    fs::remove_file(&data_dir).unwrap();
    fs::create_dir_all(data_dir).unwrap();
}

#[test]
fn plugin_host_start_returns_early_when_no_plugins_are_present() {
    let _guard = test_support::lock();
    let original_plugin = std::env::var_os("OMNITERM_DEV_PLUGIN");
    std::env::remove_var("OMNITERM_DEV_PLUGIN");

    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let plugins_dir = handle.path().app_data_dir().unwrap().join("plugins");
    let _ = fs::remove_dir_all(&plugins_dir);

    let host = PluginHost::new();
    block_on(host.start(&handle)).unwrap();
    assert!(!host.started.load(Ordering::SeqCst));
    assert!(block_on(host.disabled_reason.lock()).is_none());

    if let Some(p) = original_plugin {
        std::env::set_var("OMNITERM_DEV_PLUGIN", p);
    }
}

#[test]
fn plugin_host_start_attempts_launch_when_dev_plugin_set() {
    let _guard = test_support::lock();
    let original_plugin = std::env::var_os("OMNITERM_DEV_PLUGIN");
    let original_path = std::env::var_os("PATH");
    std::env::set_var("PATH", "");

    let plugin = TempDir::new().unwrap();
    std::env::set_var("OMNITERM_DEV_PLUGIN", plugin.path());

    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let plugins_dir = handle.path().app_data_dir().unwrap().join("plugins");
    let _ = fs::remove_dir_all(&plugins_dir);

    let host = PluginHost::new();
    let _ = block_on(host.start(&handle));

    assert!(!host.started.load(Ordering::SeqCst));
    let reason = block_on(host.disabled_reason.lock()).clone();
    assert!(reason.unwrap().contains("Could not start"));

    match original_plugin {
        Some(p) => std::env::set_var("OMNITERM_DEV_PLUGIN", p),
        None => std::env::remove_var("OMNITERM_DEV_PLUGIN"),
    }
    match original_path {
        Some(p) => std::env::set_var("PATH", p),
        None => std::env::remove_var("PATH"),
    }
}

#[test]
fn plugin_host_starts_successfully_when_node_is_available() {
    let _guard = test_support::lock();
    let original_plugin = std::env::var_os("OMNITERM_DEV_PLUGIN");
    let plugin = TempDir::new().unwrap();
    std::env::set_var("OMNITERM_DEV_PLUGIN", plugin.path());

    let app = test_support::mock_app();
    let handle = app.handle().clone();

    if std::process::Command::new("node")
        .arg("--version")
        .output()
        .is_err()
    {
        match original_plugin {
            Some(p) => std::env::set_var("OMNITERM_DEV_PLUGIN", p),
            None => std::env::remove_var("OMNITERM_DEV_PLUGIN"),
        }
        return;
    }

    let host = PluginHost::new();
    block_on(host.start(&handle)).unwrap();

    assert!(host.started.load(Ordering::SeqCst));
    let _ = block_on(host.list_plugins());

    match original_plugin {
        Some(p) => std::env::set_var("OMNITERM_DEV_PLUGIN", p),
        None => std::env::remove_var("OMNITERM_DEV_PLUGIN"),
    }
}

#[test]
fn plugin_host_start_fails_gracefully_when_node_is_missing() {
    let _guard = test_support::lock();
    let original_plugin = std::env::var_os("OMNITERM_DEV_PLUGIN");
    let original_path = std::env::var_os("PATH");
    let plugin = TempDir::new().unwrap();
    std::env::set_var("OMNITERM_DEV_PLUGIN", plugin.path());
    std::env::set_var("PATH", ""); // Remove Node from PATH

    let app = test_support::mock_app();
    let handle = app.handle().clone();

    let host = PluginHost::new();
    block_on(host.start(&handle)).unwrap();

    assert!(!host.started.load(Ordering::SeqCst));
    let disabled = block_on(host.disabled_reason.lock()).clone();
    assert!(disabled.unwrap().contains("Plugins need Node.js on your PATH."));

    if let Some(p) = original_path {
        std::env::set_var("PATH", p);
    }
    match original_plugin {
        Some(p) => std::env::set_var("OMNITERM_DEV_PLUGIN", p),
        None => std::env::remove_var("OMNITERM_DEV_PLUGIN"),
    }
}
