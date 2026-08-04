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

/// Drives the actual child-process transport rather than replacing `stdin_tx` in memory. This covers
/// startup, stdin framing, stdout parsing, normal/error RPC responses, ignored malformed output, and
/// both notification and request forms of Node-to-Rust reverse calls.
#[cfg(unix)]
#[test]
fn fake_node_sidecar_round_trips_real_process_io() {
    use std::os::unix::fs::PermissionsExt;
    use std::thread;
    use std::time::Duration;

    let _guard = test_support::lock();
    let original_path = std::env::var_os("PATH");
    let original_plugin = std::env::var_os("OMNITERM_DEV_PLUGIN");
    std::env::remove_var("OMNITERM_DEV_PLUGIN");

    let app = test_support::mock_app();
    let handle = app.handle().clone();
    let app_data = handle.path().app_data_dir().unwrap();
    let plugins_dir = app_data.join("plugins");
    let _ = fs::remove_dir_all(&plugins_dir);
    let installed = plugins_dir.join("fake-node-plugin");
    fs::create_dir_all(&installed).unwrap();
    fs::write(installed.join("package.json"), "{}").unwrap();

    let tools = TempDir::new().unwrap();
    let capture = tools.path().join("stdin.log");
    let fake_node = tools.path().join("node");
    fs::write(
        &fake_node,
        r#"#!/usr/bin/python3
import json
import os
import sys

capture = os.environ["OMNITERM_FAKE_NODE_CAPTURE"]
print("")
print("not-json")
print(json.dumps({"jsonrpc": "2.0", "method": "host.log", "params": {"message": "ready"}}))
print(json.dumps({"jsonrpc": "2.0", "id": 900, "method": "host.unknown", "params": {}}))
sys.stdout.flush()

for line in sys.stdin:
    with open(capture, "a", encoding="utf-8") as output:
        output.write(line)
    request = json.loads(line)
    method = request.get("method")
    request_id = request.get("id")
    params = request.get("params", {})
    if method is None:
        continue
    if method == "plugin.setEnabled":
        response = {"jsonrpc": "2.0", "id": request_id, "error": {"message": "disabled in test"}}
    elif method == "plugin.invoke" and params.get("method") == "missing-error-message":
        response = {"jsonrpc": "2.0", "id": request_id, "error": {}}
    elif method == "plugin.invoke" and params.get("method") == "missing-result":
        response = {"jsonrpc": "2.0", "id": request_id}
    else:
        results = {
            "plugin.available": True,
            "plugin.list": [{"id": "fake.plugin"}],
            "plugin.selectConnectionProvider": [{"id": "selected.plugin"}],
            "connections.capabilities": {"protocols": ["SSH", "RDP"]},
            "plugin.uninstall": False,
            "plugin.invoke": {"invoked": params.get("method")},
            "plugin.authGate": False,
            "connections.load": {"connections": [], "folders": []},
            "connections.save": True,
            "connections.loadScoped": None if params.get("scope", {}).get("empty") else [{"id": "scoped"}],
            "connections.saveScoped": True,
            "connections.resolveLaunch": None if params.get("connId") == "missing" else {"kind": "batch", "path": "/tmp/fake.cmd"},
        }
        if method in ("connections.resolve", "connections.resolveScoped"):
            result = None if params.get("connId") == "missing" else {"id": params.get("connId")}
        else:
            result = results.get(method)
        response = {"jsonrpc": "2.0", "id": request_id, "result": result}
    print(json.dumps(response))
    sys.stdout.flush()
"#,
    )
    .unwrap();
    let mut permissions = fs::metadata(&fake_node).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&fake_node, permissions).unwrap();

    std::env::set_var("PATH", tools.path());
    std::env::set_var("OMNITERM_FAKE_NODE_CAPTURE", &capture);

    let host = PluginHost::new();
    block_on(host.start(&handle)).unwrap();
    assert!(host.started.load(Ordering::SeqCst));
    assert!(block_on(host.is_available()));
    let plugins = block_on(host.list_plugins()).unwrap();
    assert_eq!(plugins[0]["id"], "fake.plugin");
    assert_eq!(
        block_on(host.set_enabled("fake.plugin".to_string(), false)).unwrap_err(),
        "disabled in test"
    );
    assert_eq!(
        block_on(host.select_connection_provider(Some("fake.plugin".to_string()))).unwrap()[0]["id"],
        "selected.plugin"
    );
    assert_eq!(
        block_on(host.connection_capabilities()).unwrap().unwrap()["protocols"][0],
        "SSH"
    );
    assert!(!block_on(host.uninstall("fake.plugin".to_string())).unwrap());
    assert_eq!(
        block_on(host.invoke("echo".to_string(), vec![json!(1)])).unwrap()["invoked"],
        "echo"
    );
    assert_eq!(
        block_on(host.invoke("missing-error-message".to_string(), vec![])).unwrap_err(),
        "RPC Error"
    );
    assert_eq!(
        block_on(host.invoke("missing-result".to_string(), vec![])).unwrap(),
        Value::Null
    );
    assert!(!block_on(host.auth_gate()).unwrap());
    assert_eq!(
        block_on(host.load_connections()).unwrap().unwrap()["connections"],
        json!([])
    );
    assert!(block_on(host.save_connections(json!({ "connections": [] }))).unwrap());
    assert_eq!(
        block_on(host.resolve_connection("ssh-1".to_string())).unwrap().unwrap()["id"],
        "ssh-1"
    );
    assert_eq!(
        block_on(host.resolve_connection("missing".to_string())).unwrap(),
        None
    );
    assert_eq!(
        block_on(host.load_scoped_connections(json!({ "empty": false }))).unwrap().unwrap()[0]["id"],
        "scoped"
    );
    assert_eq!(
        block_on(host.load_scoped_connections(json!({ "empty": true }))).unwrap(),
        None
    );
    assert!(block_on(host.save_scoped_connections(
        json!({ "workspaceId": "w" }),
        json!([]),
    ))
    .unwrap());
    assert_eq!(
        block_on(host.resolve_scoped_connection(
            json!({ "workspaceId": "w" }),
            "ssh-2".to_string(),
        ))
        .unwrap()
        .unwrap()["id"],
        "ssh-2"
    );
    assert_eq!(
        block_on(host.resolve_scoped_connection(
            json!({ "workspaceId": "w" }),
            "missing".to_string(),
        ))
        .unwrap(),
        None
    );
    assert_eq!(
        block_on(host.resolve_connection_launch(
            json!({ "workspaceId": "w" }),
            "ssh-3".to_string(),
        ))
        .unwrap()
        .unwrap()["kind"],
        "batch"
    );
    assert_eq!(
        block_on(host.resolve_connection_launch(
            json!({ "workspaceId": "w" }),
            "missing".to_string(),
        ))
        .unwrap(),
        None
    );

    for _ in 0..100 {
        if fs::read_to_string(&capture)
            .is_ok_and(|text| text.contains("\"id\":900") && text.contains("-32601"))
        {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    let captured = fs::read_to_string(&capture).unwrap();
    assert!(captured.contains("\"method\":\"plugin.available\""));
    assert!(captured.contains("\"method\":\"plugin.list\""));
    assert!(captured.contains("\"method\":\"plugin.setEnabled\""));
    assert!(captured.contains("\"id\":900"));
    assert!(captured.contains("-32601"));

    block_on(async {
        let removed = host.stdin_tx.lock().await.take();
        assert!(removed.is_some(), "the fake sidecar should have an input channel");
    });
    if let Some(mut child) = block_on(async { host.child.lock().await.take() }) {
        block_on(async {
            let _ = child.kill().await;
            let _ = child.wait().await;
        });
    }

    std::env::remove_var("OMNITERM_FAKE_NODE_CAPTURE");
    match original_path {
        Some(value) => std::env::set_var("PATH", value),
        None => std::env::remove_var("PATH"),
    }
    match original_plugin {
        Some(value) => std::env::set_var("OMNITERM_DEV_PLUGIN", value),
        None => std::env::remove_var("OMNITERM_DEV_PLUGIN"),
    }
    let _ = fs::remove_dir_all(plugins_dir);
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
