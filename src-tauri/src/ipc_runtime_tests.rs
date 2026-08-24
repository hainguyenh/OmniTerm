use super::IpcApp;
use crate::{plugin_host::PluginHost, pty::PtyManager};
use serde_json::{json, Value};
use std::path::Path;
use tauri::Manager;

#[test]
fn ipc_exposes_safe_runtime_and_failure_contracts() {
    let fixture = IpcApp::new();

    assert!(fixture
        .ok("system_excluded_view_exts", json!({}))
        .is_array());
    assert!(fixture.ok("list_available_shells", json!({})).is_array());
    assert_eq!(fixture.ok("clear_log", json!({})), json!(true));
    let launcher = fixture.ok("setup_launcher", json!({}));
    let launcher_dir = Path::new(launcher.as_str().expect("launcher directory"));
    assert!(launcher_dir.join("nc-open.cmd").is_file());
    assert!(launcher_dir.join("wt.cmd").is_file());
    assert!(launcher_dir.join("wt-shim.ps1").is_file());

    assert!(fixture
        .error(
            "send_session_input",
            json!({ "id": "missing", "data": "x" })
        )
        .to_string()
        .to_lowercase()
        .contains("session"));
    assert!(fixture
        .error(
            "resize_session",
            json!({ "id": "missing", "cols": 80, "rows": 24 }),
        )
        .to_string()
        .to_lowercase()
        .contains("session"));
    assert!(fixture
        .invoke("disconnect_session", json!({ "id": "missing" }))
        .is_err());
    assert!(fixture
        .invoke("prepare_ssh_session", json!({ "connId": "missing" }))
        .is_err());
    assert!(fixture
        .invoke("connect_rdp", json!({ "id": "missing" }))
        .is_err());
    assert_eq!(
        fixture.ok("rdp_disconnect", json!({ "id": "missing" })),
        Value::Null
    );

    assert_eq!(
        fixture.ok(
            "detach_terminal",
            json!({ "sessionId": "missing", "name": "Missing", "connection": {} }),
        ),
        json!(false)
    );
    assert_eq!(
        fixture.ok("bootstrap_terminal_window", json!({})),
        Value::Null
    );
    assert_eq!(
        fixture.ok("reattach_terminal", json!({ "id": "missing" })),
        json!(false)
    );
    for command in ["focus_terminal_window", "release_terminal_window"] {
        assert_eq!(fixture.ok(command, json!({ "id": "missing" })), Value::Null);
    }

    let quick_shell = fixture.ok("open_quick_shell", json!({ "shell": null }));
    assert!(quick_shell["id"]
        .as_str()
        .is_some_and(|id| id.starts_with("adhoc-")));
    assert_eq!(fixture.ok("shells_ready", json!({})), Value::Null);
    assert_eq!(
        fixture.ok("shells_release", json!({ "connId": "missing" })),
        Value::Null
    );
    assert!(fixture
        .error("open_quick_shell", json!({ "shell": "unsupported-shell" }))
        .to_string()
        .contains("Unsupported"));

    assert_eq!(fixture.ok("plugin_available", json!({})), json!(false));
    assert_eq!(fixture.ok("plugin_list", json!({})), json!([]));
    assert!(fixture
        .error(
            "plugin_set_enabled",
            json!({ "id": "missing", "enabled": true }),
        )
        .to_string()
        .to_lowercase()
        .contains("plugin host"));
    assert!(fixture
        .error("plugin_select_connection_provider", json!({ "id": null }))
        .to_string()
        .to_lowercase()
        .contains("plugin host"));
    assert_eq!(
        fixture.ok("connection_provider_capabilities", json!({})),
        Value::Null
    );
    assert!(fixture
        .error("plugin_invoke", json!({ "method": "missing", "args": [] }))
        .to_string()
        .to_lowercase()
        .contains("plugin host"));
    assert_eq!(fixture.ok("plugin_auth_gate", json!({})), json!(true));
    assert!(fixture
        .error("remove_plugin", json!({ "id": "../escape" }))
        .to_string()
        .contains("plugin"));

    assert_eq!(fixture.ok("is_maximized", json!({})), json!(false));
    assert_eq!(fixture.ok("toggle_maximize", json!({})), Value::Null);
    assert_eq!(fixture.ok("is_maximized", json!({})), json!(false));
    assert_eq!(
        fixture.ok("set_webview_zoom", json!({ "factor": 1.25 })),
        Value::Null
    );
    assert_eq!(fixture.ok("minimize_window", json!({})), Value::Null);
    assert_eq!(
        fixture.ok("set_fullscreen", json!({ "on": true })),
        Value::Null
    );

    let handle = fixture.handle();
    assert!(handle.try_state::<PtyManager>().is_some());
    assert!(handle.try_state::<PluginHost>().is_some());
}

#[test]
fn ipc_closes_the_requested_window() {
    let fixture = IpcApp::new();
    assert!(fixture.app.get_webview_window("main").is_some());
    assert_eq!(fixture.ok("close_window", json!({})), Value::Null);
}

#[test]
fn ipc_rejects_malformed_payloads_before_commands_can_act() {
    let fixture = IpcApp::new();
    let malformed = [
        ("start_local_session", json!({ "id": "x", "connId": "x" })),
        ("send_session_input", json!({ "id": "x", "data": 4 })),
        (
            "resize_session",
            json!({ "id": "x", "cols": "80", "rows": 24 }),
        ),
        ("prepare_ssh_session", json!({ "connId": 4 })),
        ("connect_rdp", json!({ "id": false })),
        ("rdp_disconnect", json!({ "id": [] })),
        ("detach_terminal", json!({ "sessionId": "x" })),
        ("attach_session", json!({ "id": "x" })),
        ("reattach_terminal", json!({ "id": 9 })),
        ("focus_terminal_window", json!({ "id": {} })),
        ("release_terminal_window", json!({ "id": [] })),
        ("save_settings", json!({})),
        ("save_theme", json!({ "theme": "dark" })),
        ("delete_theme", json!({ "id": 3 })),
        ("upload_custom_art", json!({ "slot": "idle-light" })),
        ("get_custom_art", json!({ "slot": 3 })),
        ("remove_custom_art", json!({ "slot": false })),
        ("save_connections", json!({ "data": "bad" })),
        (
            "export_json",
            json!({ "suggestedName": 7, "content": "{}" }),
        ),
        ("set_webview_zoom", json!({ "factor": "large" })),
        ("create_workspace", json!({ "name": 7 })),
        ("add_workspace", json!({ "path": 7 })),
        (
            "add_workspace_folder",
            json!({ "workspaceId": [], "path": "x" }),
        ),
        ("import_workspace_file", json!({ "path": 7 })),
        ("remove_workspace", json!({ "id": false })),
        (
            "move_workspace",
            json!({ "workspaceId": "x", "parentId": null, "index": "first" }),
        ),
        (
            "set_workspace_entry_pinned",
            json!({ "workspaceId": "x", "folderId": "folder#1", "path": "a", "pinned": "yes" }),
        ),
        ("scan_scripts", json!({ "workspaceId": [] })),
        ("scan_workspace_folders", json!({ "workspaceId": {} })),
        (
            "scan_workspace_entries",
            json!({ "workspaceId": "x", "folder": 2 }),
        ),
        (
            "run_script",
            json!({ "workspaceId": "x", "script": 2, "subPath": null }),
        ),
        ("read_script", json!({ "workspaceId": "x", "path": 2 })),
        (
            "write_script",
            json!({ "workspaceId": "x", "path": "a.sh", "content": 2 }),
        ),
        ("load_workspace_connections", json!({ "workspaceId": 2 })),
        (
            "save_workspace_connections",
            json!({ "workspaceId": "x", "data": {} }),
        ),
        (
            "delete_workspace_connection",
            json!({ "workspaceId": "x", "connectionId": 2 }),
        ),
        ("shells_release", json!({ "connId": 2 })),
        ("open_quick_shell", json!({ "shell": 2 })),
        ("plugin_set_enabled", json!({ "id": "x", "enabled": "yes" })),
        ("plugin_select_connection_provider", json!({ "id": 2 })),
        ("plugin_invoke", json!({ "method": "x", "args": {} })),
        ("remove_plugin", json!({ "id": true })),
    ];

    for (command, body) in malformed {
        assert!(
            fixture.invoke(command, body).is_err(),
            "{command} accepted a malformed IPC request"
        );
    }

    assert!(!fixture.app_data_dir.join("settings.json").exists());
    assert!(!fixture.app_data_dir.join("connections.json").exists());
    assert!(!fixture.app_data_dir.join("workspaces.json").exists());
}

#[test]
fn ipc_runs_a_quick_shell_lifecycle() {
    let fixture = IpcApp::new();
    let shell = if cfg!(target_os = "windows") {
        "cmd"
    } else {
        "sh"
    };

    let opened = fixture.ok("open_quick_shell", json!({ "shell": shell }));
    let id = opened["id"]
        .as_str()
        .expect("quick shell response carries an id")
        .to_string();
    assert_eq!(opened["type"], "LOCAL");
    assert_eq!(opened["shell"], shell);

    let handle = fixture.handle();
    let registry = handle.state::<crate::adhoc::AdhocRegistry>();
    assert!(
        registry.get(&id).is_some(),
        "quick shell must be launchable"
    );
    assert_eq!(
        fixture.ok("shells_release", json!({ "connId": id.as_str() })),
        Value::Null
    );
    assert!(
        registry.get(&id).is_none(),
        "released shell must leave the registry"
    );
}

#[test]
#[should_panic(expected = "not implemented")]
fn ipc_reaches_the_mock_runtime_restart_boundary() {
    let fixture = IpcApp::new();

    // Tauri 2.11.5 deliberately leaves restart unimplemented in MockRuntime. The expected panic
    // proves the real IPC adapter reached the runtime boundary without pretending a mock restart
    // can complete normally.
    fixture.ok("restart_app", json!({}));
}
