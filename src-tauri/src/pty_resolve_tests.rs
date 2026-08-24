//! Which saved connection a pane is allowed to launch from.
//!
//! The webview supplies the connection id, so these are the checks standing between "the user picked
//! a saved shell" and "an id we do not recognize started a process".

use super::*;
use crate::connections::{Connection, ConnectionTree};
use crate::plugin_host::PluginHost;
use crate::test_support;
use std::fs;
use std::path::PathBuf;
use std::sync::MutexGuard;
use tauri::test::MockRuntime;
use tauri::Manager;
use tempfile::TempDir;

struct Fixture {
    _guard: MutexGuard<'static, ()>,
    app: tauri::App<MockRuntime>,
    data_dir: PathBuf,
}

impl Fixture {
    fn new(with_host: bool) -> Self {
        let guard = test_support::lock();
        let app = test_support::mock_app();
        assert!(app.manage(AdhocRegistry::new()));
        if with_host {
            assert!(app.manage(PluginHost::new()));
        }
        let data_dir = app.path().app_data_dir().expect("mock app data directory");
        let _ = fs::remove_dir_all(&data_dir);
        Self {
            _guard: guard,
            app,
            data_dir,
        }
    }

    fn handle(&self) -> AppHandle<MockRuntime> {
        self.app.handle().clone()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.data_dir);
    }
}

fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

/// Build a tree from JSON, so a case only names the fields it cares about — `Connection` has a dozen
/// optional ones and a literal would bury the property under boilerplate.
fn tree(connections: serde_json::Value) -> ConnectionTree {
    serde_json::from_value(serde_json::json!({ "connections": connections, "folders": [] }))
        .expect("fixture should deserialize")
}

/// The shell this platform accepts, so the suite runs on both Windows and POSIX.
fn native_shell() -> &'static str {
    if cfg!(target_os = "windows") {
        "powershell"
    } else {
        "bash"
    }
}

fn local_connection(id: &str) -> Connection {
    serde_json::from_value(serde_json::json!({
        "id": id,
        "name": "Local",
        "type": "LOCAL",
        "shell": native_shell(),
        "localCwd": ".",
        "localCommand": "echo covered",
        "localKeepOpen": false
    }))
    .unwrap()
}

#[test]
fn resolves_a_saved_local_connection() {
    let t = tree(serde_json::json!([{
        "id": "c1", "name": "Build", "type": "LOCAL", "shell": native_shell(),
        "localCwd": "C:/proj", "localCommand": "echo hi", "localKeepOpen": false,
    }]));
    let launch = launch_from_tree(t, "c1", None).expect("should resolve");
    assert_eq!(launch.shell.as_str(), native_shell());
    assert_eq!(launch.cwd.as_deref(), Some("C:/proj"));
    assert_eq!(launch.command.as_deref(), Some("echo hi"));
    assert!(!launch.keep_open);
}

#[test]
fn refuses_an_unknown_connection_id() {
    let err = launch_from_tree(tree(serde_json::json!([])), "local-default-123", None)
        .expect_err("an unknown id must not launch");
    assert!(err.contains("local-default-123"), "got {err:?}");
}

#[test]
fn an_override_shell_does_not_rescue_an_unknown_id() {
    assert!(launch_from_tree(
        tree(serde_json::json!([])),
        "local-default-123",
        Some(native_shell().to_string()),
    )
    .is_err());
}

#[test]
fn refuses_a_connection_that_is_not_local() {
    for remote in ["SSH", "RDP"] {
        let t = tree(serde_json::json!([{
            "id": "r1", "name": "prod", "type": remote, "host": "10.0.0.1",
        }]));
        let err = launch_from_tree(t, "r1", Some(native_shell().to_string()))
            .expect_err("remote connection must not open a local pane");
        assert_eq!(err, "Not a local connection.");
    }
}

#[test]
fn a_local_connection_without_a_shell_uses_the_default() {
    let t = tree(serde_json::json!([{ "id": "c2", "name": "Shell", "type": "LOCAL" }]));
    let launch = launch_from_tree(t, "c2", None).expect("should resolve");
    assert_eq!(launch.shell, crate::shell_spec::LocalShell::Default);
}

#[test]
fn an_override_shell_wins_over_the_saved_one() {
    let t = tree(serde_json::json!([{
        "id": "c3", "name": "Shell", "type": "LOCAL", "shell": native_shell(),
    }]));
    let other = if cfg!(target_os = "windows") {
        "cmd"
    } else {
        "sh"
    };
    let launch = launch_from_tree(t, "c3", Some(other.to_string())).expect("should resolve");
    assert_eq!(launch.shell.as_str(), other);
}

#[test]
fn ssh_values_accept_only_the_native_client_safe_subset() {
    for valid in [
        "host",
        "user@example.test",
        "10.0.0.1",
        "[::1]",
        r"domain\user",
    ] {
        assert!(safe_ssh_value(valid), "expected valid: {valid}");
    }
    for invalid in ["", "bad host", "host;echo", "host&echo", "host\nnext"] {
        assert!(!safe_ssh_value(invalid), "expected invalid: {invalid:?}");
    }
    assert!(!safe_ssh_value(&"a".repeat(256)));
}

#[cfg(not(target_os = "windows"))]
#[test]
fn windows_native_clients_fail_explicitly_on_other_platforms() {
    let error = require_windows_client("ssh.exe", "ignored").unwrap_err();
    assert_eq!(error, "ssh.exe is available only on Windows.");
}

#[test]
fn resolves_ad_hoc_and_persisted_connections_through_the_real_mock_app() {
    let fixture = Fixture::new(true);
    let app = fixture.handle();
    app.state::<AdhocRegistry>().insert_named(
        "adhoc-test".to_string(),
        OpenShellRequest {
            shell: LocalShell::parse(native_shell()).unwrap(),
            cwd: Some("/tmp".to_string()),
            command: Some("echo adhoc".to_string()),
            args: Some("--flag".to_string()),
            keep_open: false,
            name: "Ad hoc".to_string(),
        },
    );

    let adhoc = block_on(resolve_connection_by_id(&app, "adhoc-test")).unwrap();
    assert_eq!(adhoc.conn_type, "LOCAL");
    assert_eq!(adhoc.local_command.as_deref(), Some("echo adhoc"));
    let launch = block_on(resolve_local_launch(&app, "adhoc-test", None)).unwrap();
    assert_eq!(launch.cwd.as_deref(), Some("/tmp"));
    assert_eq!(launch.args.as_deref(), Some("--flag"));

    let host = fixture.app.state::<PluginHost>();
    block_on(connections::save_connections(
        app.clone(),
        host,
        ConnectionTree {
            connections: vec![local_connection("saved-local")],
            folders: vec![],
        },
    ))
    .unwrap();
    assert_eq!(
        block_on(resolve_connection_by_id(&app, "saved-local"))
            .unwrap()
            .id,
        "saved-local"
    );
    assert_eq!(
        block_on(resolve_local_launch(&app, "saved-local", None))
            .unwrap()
            .command
            .as_deref(),
        Some("echo covered")
    );
    assert!(block_on(resolve_connection_by_id(&app, "missing")).is_err());
}

#[test]
fn workspace_connections_are_launchable_and_non_ssh_prepare_is_rejected() {
    let fixture = Fixture::new(true);
    let app = fixture.handle();
    let root = TempDir::new().unwrap();
    let workspace = block_on(crate::workspace::add_workspace(
        app.clone(),
        root.path().to_string_lossy().into_owned(),
    ))
    .unwrap();
    block_on(crate::workspace_connections::save_workspace_connections(
        app.clone(),
        fixture.app.state::<PluginHost>(),
        workspace.id,
        vec![local_connection("workspace-local")],
    ))
    .unwrap();

    let found = block_on(resolve_connection_by_id(&app, "workspace-local")).unwrap();
    assert_eq!(found.name, "Local");
    assert_eq!(
        block_on(prepare_ssh_session(app, "workspace-local".to_string())).unwrap_err(),
        "Not an SSH connection."
    );
}

#[test]
fn native_batch_provider_is_optional() {
    let fixture = Fixture::new(false);
    assert_eq!(
        block_on(native_batch_launch(
            &fixture.handle(),
            "missing",
            "terminal"
        ))
        .unwrap(),
        None
    );

    drop(fixture);
    let fixture = Fixture::new(true);
    assert_eq!(
        block_on(native_batch_launch(
            &fixture.handle(),
            "missing",
            "terminal"
        ))
        .unwrap(),
        None
    );
}

/// `prepare_ssh_session` rejects anything the `safe_ssh_value` check stops: a host carrying a shell
/// metacharacter (`;`) would otherwise reach `ssh.exe` as an extra argv element.
#[test]
fn prepare_ssh_session_rejects_an_unsafe_host_or_user() {
    let fixture = Fixture::new(true);
    let app = fixture.handle();

    let mut bad_host = ssh_connection("ssh-bad-host");
    bad_host.host = "host;echo".to_string();
    let mut bad_user = ssh_connection("ssh-bad-user");
    bad_user.user = "user\nroot".to_string();
    for conn in [bad_host, bad_user] {
        let id = conn.id.clone();
        save_one(&app, conn);
        let err = block_on(prepare_ssh_session(app.clone(), id.clone())).unwrap_err();
        assert!(err.contains("unsupported characters"), "got: {err}");
    }
}

/// Port parsing edge cases: out-of-range (not parseable as u16) and explicit zero both reject the
/// session before `ssh.exe` is ever consulted.
#[test]
fn prepare_ssh_session_rejects_an_unparseable_or_zero_port() {
    let fixture = Fixture::new(true);
    let app = fixture.handle();

    for (id, port) in [("ssh-bad-port", "99999"), ("ssh-zero-port", "0")] {
        let mut conn = ssh_connection(id);
        conn.port = port.to_string();
        save_one(&app, conn);
        let err = block_on(prepare_ssh_session(app.clone(), id.to_string())).unwrap_err();
        assert!(err.contains("must be between 1 and 65535"), "got: {err}");
    }
}

/// An RDP-typed connection refuses SSH preparation outright — the message in the panel depends on
/// the type check not silently accepting any record with a host string.
#[test]
fn prepare_ssh_session_refuses_an_rdp_connection() {
    let fixture = Fixture::new(true);
    let app = fixture.handle();
    let mut rdp = ssh_connection("rdp-prepare-check");
    rdp.conn_type = "RDP".to_string();
    save_one(&app, rdp);
    let err = block_on(prepare_ssh_session(app, "rdp-prepare-check".to_string())).unwrap_err();
    assert_eq!(err, "Not an SSH connection.");
}

/// A bare SSH helper so the prepare_ssh_session edge-case tests share one fixture shape.
fn ssh_connection(id: &str) -> Connection {
    serde_json::from_value(serde_json::json!({
        "id": id,
        "name": format!("Server {id}"),
        "type": "SSH",
        "host": "ssh.example.test",
        "port": "22",
        "user": "root",
    }))
    .expect("ssh fixture should deserialize")
}

/// Save one connection through the real app so a prepare_ssh_session case can resolve it.
fn save_one(app: &AppHandle<MockRuntime>, conn: Connection) {
    block_on(connections::save_connections(
        app.clone(),
        app.state::<PluginHost>(),
        ConnectionTree {
            connections: vec![conn],
            folders: vec![],
        },
    ))
    .unwrap();
}

#[test]
fn prepare_ssh_session_defaults_user_and_port() {
    let fixture = Fixture::new(true);
    let app = fixture.handle();
    let mut conn = ssh_connection("ssh-default-user-port");
    conn.user = "".to_string();
    conn.port = "".to_string();
    save_one(&app, conn);

    if cfg!(target_os = "windows") && require_windows_client("ssh.exe", "").is_ok() {
        assert!(block_on(prepare_ssh_session(
            app.clone(),
            "ssh-default-user-port".to_string()
        ))
        .is_ok());
        let adhoc = app
            .state::<AdhocRegistry>()
            .get("ssh-default-user-port")
            .unwrap();
        assert_eq!(adhoc.name, "Server ssh-default-user-port");
        assert!(adhoc
            .command
            .unwrap()
            .contains("ssh.exe -o BatchMode=no -p 22 -- \"ssh.example.test\""));
    }
}
