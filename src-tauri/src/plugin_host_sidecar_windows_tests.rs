use super::*;
use std::fs;
use tauri::Manager;
use tempfile::TempDir;

use crate::test_support;

fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

#[test]
fn fake_node_sidecar_round_trips_real_process_io_on_windows() {
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
    let fake_node_rs = tools.path().join("fake_node.rs");
    fs::write(
        &fake_node_rs,
        r##"
use std::io::{BufRead, Write};

fn main() {
    let capture = std::env::var("OMNITERM_FAKE_NODE_CAPTURE").unwrap();
    println!();
    println!("not-json");
    println!(r#"{{"jsonrpc": "2.0", "method": "host.log", "params": {{"message": "ready"}}}}"#);
    println!(r#"{{"jsonrpc": "2.0", "id": 900, "method": "host.unknown", "params": {{}}}}"#);
    println!(r#"{{"jsonrpc": "2.0", "id": "string_id", "method": "host.unknown", "params": {{}}}}"#);
    std::io::stdout().flush().unwrap();

    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let mut f = std::fs::OpenOptions::new().append(true).create(true).open(&capture).unwrap();
        writeln!(f, "{}", line).unwrap();

        let req_id = line.split(r#""id":"#).nth(1).unwrap_or("0").split(|c| c == ',' || c == '}').next().unwrap().trim();

        if line.contains(r#""method":"plugin.setEnabled""#) {
            println!(r#"{{"jsonrpc": "2.0", "id": {}, "error": {{"message": "disabled in test"}}}}"#, req_id);
        } else if line.contains(r#""method":"plugin.invoke""#) && line.contains(r#""method":"missing-error-message""#) {
            println!(r#"{{"jsonrpc": "2.0", "id": {}, "error": {{}}}}"#, req_id);
        } else if line.contains(r#""method":"plugin.invoke""#) && line.contains(r#""method":"missing-result""#) {
            println!(r#"{{"jsonrpc": "2.0", "id": {}}}"#, req_id);
        } else {
            let result = if line.contains(r#""method":"plugin.available""#) {
                "true".to_string()
            } else if line.contains(r#""method":"plugin.list""#) {
                r#"[{"id": "fake.plugin"}]"#.to_string()
            } else if line.contains(r#""method":"plugin.selectConnectionProvider""#) {
                r#"[{"id": "selected.plugin"}]"#.to_string()
            } else if line.contains(r#""method":"connections.capabilities""#) {
                r#"{"protocols": ["SSH", "RDP"]}"#.to_string()
            } else if line.contains(r#""method":"plugin.uninstall""#) {
                "false".to_string()
            } else if line.contains(r#""method":"plugin.invoke""#) {
                if line.contains("echo") {
                    r#"{"invoked": "echo"}"#.to_string()
                } else {
                    "null".to_string()
                }
            } else if line.contains(r#""method":"plugin.authGate""#) {
                "false".to_string()
            } else if line.contains(r#""method":"connections.load""#) {
                r#"{"connections": [], "folders": []}"#.to_string()
            } else if line.contains(r#""method":"connections.save""#) {
                "true".to_string()
            } else if line.contains(r#""method":"connections.loadScoped""#) {
                if line.contains(r#""empty":true"#) { "null".to_string() } else { r#"[{"id": "scoped"}]"#.to_string() }
            } else if line.contains(r#""method":"connections.saveScoped""#) {
                "true".to_string()
            } else if line.contains(r#""method":"connections.resolveLaunch""#) {
                if line.contains(r#""connId":"missing""#) { "null".to_string() } else { r#"{"kind": "batch", "path": "/tmp/fake.cmd"}"#.to_string() }
            } else if line.contains(r#""method":"connections.resolve""#) || line.contains(r#""method":"connections.resolveScoped""#) {
                if line.contains(r#""connId":"missing""#) { "null".to_string() } else {
                    // extract connId: "connId":"ssh-1"
                    let conn_id = if line.contains("ssh-1") { "ssh-1" } else { "ssh-2" };
                    format!(r#"{{"id": "{}"}}"#, conn_id)
                }
            } else {
                "null".to_string()
            };
            println!(r#"{{"jsonrpc": "2.0", "id": {}, "result": {}}}"#, req_id, result);
        }
        std::io::stdout().flush().unwrap();
    }
}
"##,
    )
    .unwrap();

    let status = std::process::Command::new("rustc")
        .arg(&fake_node_rs)
        .arg("-o")
        .arg(tools.path().join("node.exe"))
        .status()
        .unwrap();
    assert!(status.success(), "Failed to compile fake_node.rs");

    let mut new_path = tools.path().to_path_buf().into_os_string();
    if let Some(old_path) = &original_path {
        new_path.push(";");
        new_path.push(old_path);
    }
    std::env::set_var("PATH", new_path);
    std::env::set_var("OMNITERM_FAKE_NODE_CAPTURE", &capture);

    let host = PluginHost::new();
    block_on(host.start(&handle)).unwrap();
    assert!(host.started.load(Ordering::SeqCst));
    if !block_on(host.is_available()) {
        println!(
            "disabled reason: {:?}",
            block_on(host.disabled_reason.lock())
        );
        println!("plugins: {:?}", block_on(host.list_plugins()));
    }
    assert!(block_on(host.is_available()));
    let plugins = block_on(host.list_plugins()).unwrap();
    assert_eq!(plugins[0]["id"], "fake.plugin");
    assert_eq!(
        block_on(host.set_enabled("fake.plugin".to_string(), false)).unwrap_err(),
        "disabled in test"
    );
    assert_eq!(
        block_on(host.select_connection_provider(Some("fake.plugin".to_string()))).unwrap()[0]
            ["id"],
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
        block_on(host.resolve_connection("ssh-1".to_string()))
            .unwrap()
            .unwrap()["id"],
        "ssh-1"
    );
    assert_eq!(
        block_on(host.resolve_connection("missing".to_string())).unwrap(),
        None
    );
    assert_eq!(
        block_on(host.load_scoped_connections(json!({ "empty": false })))
            .unwrap()
            .unwrap()[0]["id"],
        "scoped"
    );
    assert_eq!(
        block_on(host.load_scoped_connections(json!({ "empty": true }))).unwrap(),
        None
    );
    assert!(
        block_on(host.save_scoped_connections(json!({ "workspaceId": "w" }), json!([]),)).unwrap()
    );
    assert_eq!(
        block_on(
            host.resolve_scoped_connection(json!({ "workspaceId": "w" }), "ssh-2".to_string(),)
        )
        .unwrap()
        .unwrap()["id"],
        "ssh-2"
    );
    assert_eq!(
        block_on(
            host.resolve_scoped_connection(json!({ "workspaceId": "w" }), "missing".to_string(),)
        )
        .unwrap(),
        None
    );
    assert_eq!(
        block_on(
            host.resolve_connection_launch(json!({ "workspaceId": "w" }), "ssh-3".to_string(),)
        )
        .unwrap()
        .unwrap()["kind"],
        "batch"
    );
    assert_eq!(
        block_on(
            host.resolve_connection_launch(json!({ "workspaceId": "w" }), "missing".to_string(),)
        )
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
        assert!(
            removed.is_some(),
            "the fake sidecar should have an input channel"
        );
    });
    if let Some(mut child) = block_on(async { host.child.lock().await.take() }) {
        block_on(async {
            let _ = child.kill().await;
            let _ = child.wait().await;

            // Wait a moment for the OS to realize the pipe is broken
            std::thread::sleep(Duration::from_millis(100));

            // Now trigger a write to hit the write_all error branch
            let _ = host.set_enabled("fake.plugin".to_string(), true).await;

            // Allow the write task to process the message and hit `break`
            std::thread::sleep(Duration::from_millis(50));
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
