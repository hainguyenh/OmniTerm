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
#[path = "pty_resolve_coverage_tests.rs"]
mod coverage_tests;
#[cfg(test)]
#[path = "pty_resolve_tests.rs"]
mod tests;

fn safe_ssh_value(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':' | '[' | ']' | '@' | '\\')
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

/// Prepare Windows OpenSSH as a normal ConPTY session. Authentication remains interactive, so the
/// password is handled by `ssh.exe` and terminal input rather than serialized through the webview.
#[tauri::command]
pub async fn prepare_ssh_session<R: Runtime>(
    app: AppHandle<R>,
    conn_id: String,
) -> Result<(), String> {
    // The saved profile only: a previous connect left its `ssh.exe` launch in the ad-hoc registry
    // under this same id, and that entry reads as a LOCAL shell, so reconnecting failed with
    // "Not an SSH connection." until the tab was closed.
    let conn = lookup_saved(&app, &conn_id)
        .await
        .ok_or_else(|| format!("Unknown connection \"{conn_id}\"."))?;
    if conn.conn_type != "SSH" {
        return Err("Not an SSH connection.".to_string());
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

/// Every place a saved connection can live, in precedence order: the global tree, then profiles
/// committed inside a workspace (which an earlier version never consulted, so a workspace connection
/// could be listed but not launched).
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
    workspace_connections::find_by_id(app, conn_id)
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
