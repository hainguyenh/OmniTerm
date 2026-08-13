//! Which saved connection a pane may launch from.
//!
//! Split out of pty.rs so the id/type checks standing between "the webview named a connection" and
//! "a process started" are testable without a running app — and so pty.rs stays about the PTY itself.

use crate::adhoc::AdhocRegistry;
use crate::connections;
use crate::launch::{resolve_launch, LocalLaunch};
use crate::openshell::OpenShellRequest;
use crate::shell_spec::LocalShell;
use crate::workspace_connections;
use tauri::{AppHandle, Manager, Runtime};

#[cfg(test)]
#[path = "pty_resolve_tests.rs"]
mod tests;
#[cfg(test)]
#[path = "pty_resolve_coverage_tests.rs"]
mod coverage_tests;

fn safe_ssh_value(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value.chars().all(|c| {
            c.is_ascii_alphanumeric()
                || matches!(c, '.' | '_' | '-' | ':' | '[' | ']' | '@' | '\\')
        })
}

#[cfg(target_os = "windows")]
pub(crate) fn require_windows_client(executable: &str, install_hint: &str) -> Result<(), String> {
    let available = std::process::Command::new("where.exe")
        .arg(executable)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    if available {
        Ok(())
    } else {
        Err(format!("{executable} is not installed. {install_hint}"))
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn require_windows_client(executable: &str, _: &str) -> Result<(), String> {
    Err(format!("{executable} is available only on Windows."))
}

pub(crate) async fn native_batch_launch<R: Runtime>(
    app: &AppHandle<R>,
    conn_id: &str,
    presentation: &str,
) -> Result<Option<String>, String> {
    let Some(host) = app.try_state::<crate::plugin_host::PluginHost>() else {
        return Ok(None);
    };
    let mut scopes = vec![serde_json::json!({ "kind": "personal" })];
    if let Ok(workspaces) = crate::workspace::read_workspaces(app) {
        for workspace in workspaces {
            for folder in workspace.folders {
                scopes.push(serde_json::json!({
                    "kind": "workspace",
                    "workspaceId": &workspace.id,
                    "workspacePath": &folder.path,
                }));
            }
        }
    }
    for scope in scopes {
        let Some(spec) = host
            .resolve_connection_launch(scope.clone(), conn_id.to_string())
            .await?
        else {
            continue;
        };
        if spec.get("kind").and_then(|value| value.as_str()) != Some("batch")
            || spec.get("presentation").and_then(|value| value.as_str()) != Some(presentation)
        {
            continue;
        }
        let raw = spec
            .get("path")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "The connection provider returned an invalid launcher path.".to_string())?;
        if raw
            .chars()
            .any(|value| matches!(value, '&' | '|' | '<' | '>' | '^' | '%' | '!' | '\r' | '\n'))
        {
            return Err("The launcher path contains unsupported command characters.".to_string());
        }
        let launcher = std::fs::canonicalize(raw)
            .map_err(|_| "The generated connection launcher is missing.".to_string())?;
        if launcher.extension().and_then(|value| value.to_str()) != Some("bat") {
            return Err("The connection provider returned a non-BAT launcher.".to_string());
        }
        let allowed = if scope.get("kind").and_then(|value| value.as_str()) == Some("workspace") {
            scope
                .get("workspacePath")
                .and_then(|value| value.as_str())
                .map(|root| std::path::Path::new(root).join(".omniterm").join("launchers"))
        } else {
            app.path()
                .app_data_dir()
                .ok()
                .map(|root| root.join("plugin-storage"))
        };
        let allowed = allowed
            .and_then(|root| std::fs::canonicalize(root).ok())
            .ok_or_else(|| "The launcher directory is unavailable.".to_string())?;
        if !launcher.starts_with(allowed) {
            return Err("The connection provider returned a launcher outside its allowed directory.".to_string());
        }
        return Ok(Some(launcher.to_string_lossy().into_owned()));
    }
    Ok(None)
}

/// Prepare Windows OpenSSH as a normal ConPTY session. Authentication remains interactive, so the
/// password is handled by `ssh.exe` and terminal input rather than serialized through the webview.
#[tauri::command]
pub async fn prepare_ssh_session<R: Runtime>(
    app: AppHandle<R>,
    conn_id: String,
) -> Result<(), String> {
    let conn = resolve_connection_by_id(&app, &conn_id).await?;
    if conn.conn_type != "SSH" {
        return Err("Not an SSH connection.".to_string());
    }
    if let Some(batch) = native_batch_launch(&app, &conn_id, "terminal").await? {
        app.state::<crate::adhoc::AdhocRegistry>().insert_named(
            conn_id,
            OpenShellRequest {
                shell: LocalShell::Cmd,
                cwd: None,
                command: Some(format!("call \"{batch}\"")),
                args: None,
                keep_open: false,
                name: conn.name,
            },
        );
        return Ok(());
    }
    // Validate the saved-record fields before checking for the native client: an unsafe host or
    // port is a configuration error regardless of platform, surfacing the right message instead of
    // masking it behind "ssh.exe is not available".
    if !safe_ssh_value(&conn.host) || (!conn.user.is_empty() && !safe_ssh_value(&conn.user)) {
        return Err("SSH host or username contains unsupported characters.".to_string());
    }
    let port = if conn.port.is_empty() {
        22
    } else {
        conn.port
            .parse::<u16>()
            .map_err(|_| "SSH port must be between 1 and 65535.".to_string())?
    };
    if port == 0 {
        return Err("SSH port must be between 1 and 65535.".to_string());
    }
    require_windows_client(
        "ssh.exe",
        "Enable the Windows OpenSSH Client optional feature, then try again.",
    )?;
    let destination = if conn.user.is_empty() {
        conn.host
    } else {
        format!("{}@{}", conn.user, conn.host)
    };
    let command = format!("ssh.exe -o BatchMode=no -p {port} -- \"{destination}\"");
    app.state::<crate::adhoc::AdhocRegistry>().insert_named(
        conn_id,
        OpenShellRequest {
            shell: LocalShell::Cmd,
            cwd: None,
            command: Some(command),
            args: None,
            keep_open: false,
            name: conn.name,
        },
    );
    Ok(())
}

/// Resolve a connection id to its launch params.
///
/// Checks the in-memory ad-hoc registry first: a pane opened by the cooperative launcher, the
/// Workspace view or the "new session" button carries an `adhoc-…` id whose shell/cwd/command exist
/// only there, never in connections.json. The first port looked the id up in the webview against the
/// persisted tree only, so every ad-hoc launch silently degraded to a bare default shell in the wrong
/// directory.
///
/// An id that resolves to nothing is an error, deliberately: the alternative — launching whatever
/// shell the webview named — would make the renderer, not this module, the thing that decides what
/// gets spawned. A pane with no saved connection registers itself through `open_quick_shell` first.
/// Resolve a connection ID to a Connection struct from adhoc registry or connections tree.
pub async fn resolve_connection_by_id<R: Runtime>(
    app: &AppHandle<R>,
    conn_id: &str,
) -> Result<connections::Connection, String> {
    if let Some(req) = app.state::<AdhocRegistry>().get(conn_id) {
        return Ok(connections::Connection {
            id: conn_id.to_string(),
            name: req.name,
            conn_type: "LOCAL".to_string(),
            host: String::new(),
            port: String::new(),
            user: String::new(),
            password_help_url: None,
            parent_id: None,
            redirect_drives: None,
            shell: Some(req.shell.as_str().to_string()),
            local_args: req.args,
            local_cwd: req.cwd,
            local_command: req.command,
            local_keep_open: Some(req.keep_open),
        });
    }

    if let Some(conn) = lookup_saved(app, conn_id).await {
        return Ok(conn);
    }
    Err(format!("Unknown connection \"{conn_id}\"."))
}

/// Every place a saved connection can live, in precedence order.
///
/// Only the global tree was consulted before, which left two features non-functional: a workspace
/// connection could be created and listed but never launched, and `PluginHost::resolve_connection` was
/// dead code — so a plugin could own the connection tree yet not be asked to resolve from it.
async fn lookup_saved<R: Runtime>(
    app: &AppHandle<R>,
    conn_id: &str,
) -> Option<connections::Connection> {
    // The user's own global tree first: it is what the connections panel edits.
    if let Ok(tree) = connections::read_tree(app) {
        if let Some(found) = tree.connections.into_iter().find(|c| c.id == conn_id) {
            return Some(found);
        }
    }

    // Then profiles committed inside a workspace.
    if let Some(found) = workspace_connections::find_by_id(app, conn_id) {
        return Some(found);
    }

    let host = app.try_state::<crate::plugin_host::PluginHost>()?;
    for workspace in crate::workspace::read_workspaces(app).ok()? {
        for folder in workspace.folders {
            let scope = serde_json::json!({
                "kind": "workspace",
                "workspaceId": &workspace.id,
                "workspacePath": &folder.path,
            });
            if let Ok(Some(resolved)) = host
                .resolve_scoped_connection(scope, conn_id.to_string())
                .await
            {
                if let Ok(connection) = serde_json::from_value(resolved) {
                    return Some(connection);
                }
            }
        }
    }

    // Finally the selected plugin's Personal tree. Last because a plugin's `resolve` may open the
    // optional password-help page, so it should not run for
    // an id the host could already answer.
    //
    // Plugin connections are metadata-only and authentication remains in the native client prompt.
    let resolved = host.resolve_connection(conn_id.to_string()).await.ok()??;
    serde_json::from_value(resolved).ok()
}

/// Async so it can consult the same places `resolve_connection_by_id` does. It was sync and read only
/// the global tree, which is why a LOCAL connection saved into a workspace could be listed but not
/// opened.
pub async fn resolve_local_launch<R: Runtime>(
    app: &AppHandle<R>,
    conn_id: &str,
    override_shell: Option<String>,
) -> Result<LocalLaunch, String> {
    if let Some(req) = app.state::<AdhocRegistry>().get(conn_id) {
        return resolve_launch(
            Some(req.shell.as_str()),
            override_shell.as_deref(),
            req.cwd,
            req.args,
            req.command,
            Some(req.keep_open),
        );
    }

    let conn = lookup_saved(app, conn_id)
        .await
        .ok_or_else(|| format!("Unknown connection \"{conn_id}\"."))?;
    launch_from_connection(conn, override_shell)
}

/// The saved-connection half of `resolve_local_launch`, split out so the id and type checks are
/// testable without a running app.
fn launch_from_connection(
    conn: connections::Connection,
    override_shell: Option<String>,
) -> Result<LocalLaunch, String> {
    // Electron refused this too ('Not a local connection'): an SSH/RDP record has no shell of its
    // own, so honoring it here would open a local pane on the strength of a remote connection's id.
    if conn.conn_type != "LOCAL" {
        return Err("Not a local connection.".to_string());
    }

    resolve_launch(
        conn.shell.as_deref(),
        override_shell.as_deref(),
        conn.local_cwd,
        conn.local_args,
        conn.local_command,
        conn.local_keep_open,
    )
}

/// Tree-scoped wrapper retained for the id/type tests, which exercise the checks without an app.
#[cfg(test)]
fn launch_from_tree(
    tree: connections::ConnectionTree,
    conn_id: &str,
    override_shell: Option<String>,
) -> Result<LocalLaunch, String> {
    let conn = tree
        .connections
        .into_iter()
        .find(|c| c.id == conn_id)
        .ok_or_else(|| format!("Unknown connection \"{conn_id}\"."))?;
    launch_from_connection(conn, override_shell)
}
