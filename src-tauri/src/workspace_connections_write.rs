//! Saving and deleting the SSH and Remote Desktop profiles of a workspace, in the same
//! `<folder>/.omniterm/connections.json` files `workspace_connections` reads.
//!
//! **No credential is ever written:** `Connection` has no password field. The user types a
//! password at the server's own prompt. Every field is validated here, not in the webview: the
//! host and user end up as `ssh` / `mstsc` arguments, so a value starting with `-` would be read
//! as an option.

use crate::connections::Connection;
use crate::safepath;
use crate::workspace::find_workspace;
use crate::workspace_connections::{read_at, WorkspaceConnectionsFile};
use std::fs;
use tauri::{AppHandle, Runtime};

#[cfg(test)]
#[path = "workspace_connections_write_tests.rs"]
mod tests;

const MAX_FIELD: usize = 255;
const MAX_ID: usize = 64;

/// A host or user name: one token, no option-looking prefix, no whitespace or control characters.
fn valid_token(value: &str) -> bool {
    !value.starts_with('-')
        && value.len() <= MAX_FIELD
        && !value.chars().any(|c| c.is_whitespace() || c.is_control())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The profile as it will be stored: SSH or RDP only, trimmed, checked, and with every field that
/// belongs to a local shell dropped. A new profile (no usable id) gets one.
pub(crate) fn validated(connection: Connection) -> Result<Connection, String> {
    let conn_type = connection.conn_type.trim().to_ascii_uppercase();
    if conn_type != "SSH" && conn_type != "RDP" {
        return Err("Only SSH and Remote Desktop connections can be saved here.".to_string());
    }
    let host = connection.host.trim().to_string();
    if host.is_empty() {
        return Err("Enter the host to connect to.".to_string());
    }
    if !valid_token(&host) {
        return Err("The host must be one name or address, without spaces.".to_string());
    }
    let user = connection.user.trim().to_string();
    if !user.is_empty() && !valid_token(&user) {
        return Err("The user name must be one word, without spaces.".to_string());
    }
    let port = connection.port.trim().to_string();
    if !port.is_empty() && !matches!(port.parse::<u16>(), Ok(p) if p > 0) {
        return Err("The port must be a number from 1 to 65535.".to_string());
    }
    let name = connection.name.trim();
    if name.chars().any(char::is_control) || name.len() > MAX_FIELD {
        return Err("The name is too long or has control characters.".to_string());
    }
    let name = if name.is_empty() {
        if user.is_empty() {
            host.clone()
        } else {
            format!("{user}@{host}")
        }
    } else {
        name.to_string()
    };
    let id = if valid_id(&connection.id) {
        connection.id
    } else {
        format!("conn-{}", uuid::Uuid::new_v4())
    };
    Ok(Connection {
        id,
        name,
        redirect_drives: (conn_type == "RDP")
            .then_some(connection.redirect_drives)
            .flatten(),
        conn_type,
        host,
        port,
        user,
        password_help_url: None,
        parent_id: None,
        shell: None,
        local_args: None,
        local_cwd: None,
        local_command: None,
        local_keep_open: None,
    })
}

fn write_at(folder_path: &str, connections: Vec<Connection>) -> Result<(), String> {
    let dir = safepath::safe_subdir(folder_path, ".omniterm", true)?;
    let json = serde_json::to_string_pretty(&WorkspaceConnectionsFile { connections })
        .map_err(|error| error.to_string())?;
    fs::write(dir.join("connections.json"), json)
        .map_err(|error| format!("Cannot save workspace connections: {error}"))
}

/// Replaces the profile with the same id in whichever folder holds it (keeping its place in that
/// file's tree), else adds it to the first folder.
pub(crate) fn upsert_in(folders: &[String], connection: Connection) -> Result<Connection, String> {
    let first = folders
        .first()
        .ok_or_else(|| "This workspace has no folder to save connections in.".to_string())?;
    for folder in folders {
        let mut existing = read_at(folder)?;
        if let Some(slot) = existing.iter_mut().find(|c| c.id == connection.id) {
            let parent_id = slot.parent_id.take();
            *slot = Connection {
                parent_id,
                ..connection.clone()
            };
            write_at(folder, existing)?;
            return Ok(connection);
        }
    }
    let mut existing = read_at(first)?;
    existing.push(connection.clone());
    write_at(first, existing)?;
    Ok(connection)
}

/// Removes the profile from whichever folder holds it. False: no folder had it.
pub(crate) fn remove_from(folders: &[String], connection_id: &str) -> Result<bool, String> {
    for folder in folders {
        let mut existing = read_at(folder)?;
        let before = existing.len();
        existing.retain(|c| c.id != connection_id);
        if existing.len() != before {
            write_at(folder, existing)?;
            return Ok(true);
        }
    }
    Ok(false)
}

fn folder_paths<R: Runtime>(app: &AppHandle<R>, workspace_id: &str) -> Result<Vec<String>, String> {
    Ok(find_workspace(app, workspace_id)?
        .folders
        .into_iter()
        .filter(|folder| !folder.disabled)
        .map(|folder| folder.path)
        .collect())
}

#[tauri::command]
pub async fn save_workspace_connection<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    connection: Connection,
) -> Result<Connection, String> {
    let connection = validated(connection)?;
    upsert_in(&folder_paths(&app, &workspace_id)?, connection)
}

#[tauri::command]
pub async fn delete_workspace_connection<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    connection_id: String,
) -> Result<bool, String> {
    remove_from(&folder_paths(&app, &workspace_id)?, &connection_id)
}
