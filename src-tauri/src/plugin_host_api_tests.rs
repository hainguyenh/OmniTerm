//! Tests for the host side of the plugin sidecar protocol.
//!
//! The focus is `handle_reverse_call`'s failure contract and URL validation.

use super::*;
use serde_json::json;


#[test]
fn an_unknown_method_errors_instead_of_returning_null() {
    // Unknown capabilities must fail loudly rather than fake success. Any future
    // capability added to host-api.cjs but not here must fail loudly rather than fake success.
    let err = handle_reverse_call("host.somethingNew", None).expect_err("unknown must not resolve");
    assert!(err.contains("host.somethingNew"), "error should name the method: {err}");
}

/// `writeClipboard` is declared in the contract but not implemented by this host. It must be in the
/// erroring set, not silently succeeding.
#[test]
fn unimplemented_contract_methods_error() {
    assert!(handle_reverse_call("host.writeClipboard", Some(&json!({ "text": "x" }))).is_err());
}

#[test]
fn log_is_accepted() {
    assert!(handle_reverse_call("host.log", Some(&json!({ "message": "hello" }))).is_ok());
    // A malformed payload is tolerated: there is nothing to report a bad log line to.
    assert!(handle_reverse_call("host.log", None).is_ok());
}

#[test]
fn open_external_refuses_everything_but_https() {
    for url in [
        "file:///C:/Windows/System32/cmd.exe",
        "C:\\evil.exe",
        "http://vault.example/x",
        "javascript:alert(1)",
        "ms-settings:",
        // Reads as vault.example to a human, resolves to evil.test.
        "https://vault.example@evil.test/x",
    ] {
        let out = handle_reverse_call("host.openExternal", Some(&json!({ "url": url })));
        assert!(out.is_err(), "{url} should be refused");
    }
}

#[test]
fn open_external_requires_a_url_parameter() {
    assert!(handle_reverse_call("host.openExternal", None).is_err());
    assert!(handle_reverse_call("host.openExternal", Some(&json!({ "url": 42 }))).is_err());
}

/// The reply the stdout reader builds for a failed reverse call. `protocol.cjs` turns an `error`
/// member into a rejected promise and a `result` member into a resolved one, so which member is
/// present is the whole difference between the plugin learning it failed and the plugin being lied to.
#[test]
fn a_refusal_serializes_as_a_json_rpc_error_not_a_result() {
    let outcome = handle_reverse_call("host.unknown", None);
    let reply = match outcome {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": 7, "result": result }),
        Err(message) => json!({
            "jsonrpc": "2.0",
            "id": 7,
            "error": { "code": -32601, "message": message }
        }),
    };

    assert!(reply.get("result").is_none(), "a refusal must carry no result member");
    let error = reply.get("error").expect("refusal must carry an error member");
    assert_eq!(error["code"], -32601);
    assert!(error["message"].as_str().unwrap().contains("host.unknown"));
}

/// The startup crash: `node \\?\D:\...\plugin-host.cjs` dies with `EISDIR: lstat 'D:'` before running a
/// line of the sidecar, because Node reads `\\?\` as the entire root and stats the drive letter as if it
/// were a directory entry. Tauri hands out exactly that form for `BaseDirectory::Resource`.
#[test]
fn node_arg_path_strips_the_windows_verbatim_prefix() {
    assert_eq!(
        node_arg_path(Path::new(r"\\?\D:\workspace\sidecar\plugin-host.cjs")),
        PathBuf::from(r"D:\workspace\sidecar\plugin-host.cjs")
    );
}

#[test]
fn node_arg_path_leaves_loadable_paths_alone() {
    for path in [
        r"D:\workspace\sidecar\plugin-host.cjs",
        "/usr/lib/omniterm/plugin-host.cjs",
        // The prefix is load-bearing in the UNC form: `UNC\server\share` is not a path.
        r"\\?\UNC\server\share\plugin-host.cjs",
        r"\\server\share\plugin-host.cjs",
    ] {
        assert_eq!(node_arg_path(Path::new(path)), PathBuf::from(path), "{path}");
    }
}

#[test]
fn disabled_descriptor_formats_error_descriptor() {
    let desc = disabled_descriptor("Node.js not found".to_string());
    assert_eq!(desc["id"], "omniterm.plugin-host");
    assert_eq!(desc["status"], "error");
    assert_eq!(desc["error"], "Node.js not found");
    assert_eq!(desc["enabled"], false);
}

#[cfg(target_os = "linux")]
#[test]
fn open_external_reports_real_opener_success_and_failure() {
    use crate::test_support;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    let _guard = test_support::lock();
    let original_path = std::env::var_os("PATH");
    let tools = tempfile::tempdir().unwrap();
    let opener = tools.path().join("xdg-open");
    fs::write(&opener, "#!/bin/sh\nexit 0\n").unwrap();
    let mut permissions = fs::metadata(&opener).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&opener, permissions).unwrap();
    std::env::set_var("PATH", tools.path());

    assert_eq!(
        handle_reverse_call(
            "host.openExternal",
            Some(&json!({ "url": "https://docs.example.test/help" })),
        ),
        Ok(Value::Bool(true))
    );

    fs::remove_file(opener).unwrap();
    assert!(handle_reverse_call(
        "host.openExternal",
        Some(&json!({ "url": "https://docs.example.test/missing" })),
    )
    .is_err());

    match original_path {
        Some(value) => std::env::set_var("PATH", value),
        None => std::env::remove_var("PATH"),
    }
}
