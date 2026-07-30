use super::*;
use std::fs;
use tempfile::TempDir;
use tauri::Manager;

use crate::test_support;

fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

/// Drives the actual child-process transport rather than replacing `stdin_tx` in memory. This covers
/// startup, stdin framing, stdout parsing, normal/error RPC responses, ignored malformed output, and
/// both notification and request forms of Node-to-Rust reverse calls.
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
