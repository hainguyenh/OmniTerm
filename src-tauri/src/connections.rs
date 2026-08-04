//! Connection tree persistence and plain JSON export/import.
//!
//! **This module stores no credential of any kind.** `Connection` has no password field, so there is
//! nothing for `save_connections` to write and nothing for `load_connections` to hand the webview.
//! A password is typed by the user at the server's own prompt, inside the terminal. Neither the host
//! nor the bundled plugins expose password-storage APIs. `scrub_stored_secrets` below removes values
//! left by an earlier build that did persist them.

use crate::tree_validate::{self, MAX_IMPORT_FILE_BYTES};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

#[cfg(test)]
#[path = "connections_tests.rs"]
mod tests;
#[cfg(test)]
#[path = "connections_coverage_tail_tests.rs"]
mod coverage_tail_tests;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub conn_type: String, // "SSH", "RDP", "LOCAL"
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: String,
    #[serde(default)]
    pub user: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "passwordHelpUrl"
    )]
    pub password_help_url: Option<String>,
    // No password field: a file written by an older build still loads, serde drops unknown legacy
    // keys, and `scrub_stored_secrets` rewrites the file without them.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "parentId")]
    pub parent_id: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "redirectDrives"
    )]
    pub redirect_drives: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "localArgs")]
    pub local_args: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "localCwd")]
    pub local_cwd: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "localCommand"
    )]
    pub local_command: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "localKeepOpen"
    )]
    pub local_keep_open: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "parentId")]
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConnectionTree {
    #[serde(default)]
    pub connections: Vec<Connection>,
    #[serde(default)]
    pub folders: Vec<Folder>,
}

/// What an imported file turned out to be.
#[derive(Debug)]
pub enum ImportOutcome {
    /// A plain export, already schema-validated.
    Plain { folders: Value, connections: Value },
}

pub fn connections_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }
    Ok(app_dir.join("connections.json"))
}

/// Read the persisted tree. A parse failure is an error, not an empty tree: silently defaulting
/// (as the first port did with `unwrap_or_default`) shows the user zero connections and then
/// overwrites the salvageable file on the next save.
pub fn read_tree<R: Runtime>(app: &AppHandle<R>) -> Result<ConnectionTree, String> {
    let path = connections_path(app)?;
    if !path.exists() {
        return Ok(ConnectionTree::default());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if data.trim().is_empty() {
        return Ok(ConnectionTree::default());
    }
    serde_json::from_str(&data).map_err(|e| {
        format!(
            "connections.json is corrupt ({e}). It has been left untouched at {}.",
            path.display()
        )
    })
}

/// Keys an earlier build wrote to disk in plaintext. Named here rather than inferred so the scrub
/// stays deliberate: adding a key to this list is the only way to widen what it rewrites.
const LEGACY_SECRET_KEYS: [&str; 2] = ["password", "hasPassword"];

/// Does any connection in this raw tree still carry a key we no longer store?
fn has_legacy_secret(raw: &Value) -> bool {
    raw.get("connections")
        .and_then(Value::as_array)
        .is_some_and(|connections| {
            connections.iter().any(|c| {
                LEGACY_SECRET_KEYS
                    .iter()
                    .any(|key| c.get(key).is_some_and(|v| !v.is_null()))
            })
        })
}

/// Delete plaintext credentials left on disk by a build that used to persist them.
///
/// Dropping the struct field alone is not enough: serde ignores the unknown key, so the secret sits
/// in `connections.json` until something happens to trigger a save — which for a user who never
/// edits a connection is never. Run once at startup, before the renderer can ask for the tree.
///
/// Best-effort by design. A failure here must not stop the app from launching, so it is logged and
/// swallowed; the tree still loads without the secret either way, it just stays on disk.
pub fn scrub_stored_secrets<R: Runtime>(app: &AppHandle<R>) {
    let Ok(path) = connections_path(app) else { return };
    if !path.exists() {
        return;
    }
    let Ok(text) = fs::read_to_string(&path) else { return };
    let Ok(raw) = serde_json::from_str::<Value>(&text) else {
        // Corrupt file: `read_tree` reports this to the user with the path intact. Rewriting it here
        // would destroy whatever is salvageable.
        return;
    };
    if !has_legacy_secret(&raw) {
        return;
    }

    // Round-trip through `ConnectionTree`, which has no field for a secret to survive in.
    let Ok(tree) = serde_json::from_value::<ConnectionTree>(raw) else { return };
    let rewritten = serde_json::to_string_pretty(&tree)
        .map_err(|e| e.to_string())
        .and_then(|json| fs::write(&path, json).map_err(|e| e.to_string()));
    match rewritten {
        Ok(()) => log::info!(
            "[connections] removed stored credentials from {} — this build never saves one",
            path.display()
        ),
        Err(e) => log::warn!(
            "[connections] could not rewrite {} to remove stored credentials: {e}",
            path.display()
        ),
    }
}

#[tauri::command]
pub async fn load_connections<R: Runtime>(app: AppHandle<R>, host: tauri::State<'_, crate::plugin_host::PluginHost>) -> Result<ConnectionTree, String> {
    if let Ok(Some(remote_data)) = host.load_connections().await {
        if let Ok(tree) = serde_json::from_value(remote_data) {
            return Ok(tree);
        }
    }
    read_tree(&app)
}

#[tauri::command]
pub async fn save_connections<R: Runtime>(app: AppHandle<R>, host: tauri::State<'_, crate::plugin_host::PluginHost>, data: ConnectionTree) -> Result<(), String> {
    // Validate on the way in. This is the choke point every import path funnels through.
    let as_value = serde_json::to_value(&data).map_err(|e| e.to_string())?;
    tree_validate::validate_tree(&as_value["folders"], &as_value["connections"])?;

    if let Ok(true) = host.save_connections(as_value).await {
        // Handled by plugin host
        return Ok(());
    }

    let path = connections_path(&app)?;
    // Serialized from `ConnectionTree`, not from the caller's JSON — a webview that posts an extra
    // `password` key gets it dropped at deserialization rather than written back out.
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// Read a user-chosen file, refusing anything oversized before the bytes are pulled into memory.
fn read_bounded(path: &Path) -> Result<String, String> {
    let size = fs::metadata(path)
        .map_err(|_| "Cannot read the selected file.".to_string())?
        .len();
    if size > MAX_IMPORT_FILE_BYTES {
        return Err(format!(
            "File too large to import (max {} MB).",
            MAX_IMPORT_FILE_BYTES / 1024 / 1024
        ));
    }
    fs::read_to_string(path).map_err(|_| "Cannot read the selected file.".to_string())
}

/// Classify an imported file's contents.
///
/// An encrypted vault backup is rejected rather than decrypted: this build ships no crypto, because
/// it has no secret to protect. The check must stay keyed off the `encrypted` flag and must come
/// first — both `ConnectionTree` fields are `#[serde(default)]`, so *every* JSON object deserializes
/// successfully, and a backup would otherwise be reported as a plain tree with zero connections.
pub fn parse_import_content(text: &str) -> Result<ImportOutcome, String> {
    let parsed: Value =
        serde_json::from_str(text).map_err(|_| "Invalid JSON file — cannot import.".to_string())?;

    if parsed.get("encrypted") == Some(&json!(true)) {
        return Err("This is an encrypted vault backup, which this build cannot read — it ships no \
                    credential storage. Export a plain JSON file from the version that created it, \
                    or install a connection-manager plugin."
            .to_string());
    }

    let folders = parsed.get("folders").cloned().unwrap_or_else(|| json!([]));
    let connections = parsed
        .get("connections")
        .cloned()
        .unwrap_or_else(|| json!([]));
    tree_validate::validate_tree(&folders, &connections)?;

    // Round-trip through `ConnectionTree` so a file exported by a build that *did* save passwords
    // imports its connection metadata but leaves the secrets at the door. Without this the raw
    // `Value` — plaintext and all — would be handed straight to the webview by `import_file`, and
    // only dropped later at save time, after it had already crossed into the renderer.
    let tree: ConnectionTree = serde_json::from_value(json!({
        "folders": folders,
        "connections": connections,
    }))
    .map_err(|e| format!("Rejected: malformed connection tree ({e})."))?;

    Ok(ImportOutcome::Plain {
        folders: serde_json::to_value(&tree.folders).map_err(|e| e.to_string())?,
        connections: serde_json::to_value(&tree.connections).map_err(|e| e.to_string())?,
    })
}

/// Render an `ImportOutcome` as the object the renderer expects from `files.importFile()`.
pub fn import_outcome_to_value(outcome: ImportOutcome) -> Value {
    match outcome {
        ImportOutcome::Plain {
            folders,
            connections,
        } => json!({ "folders": folders, "connections": connections }),
    }
}

// ── Dialog-driven commands ───────────────────────────────────────────────────

#[tauri::command]
pub async fn export_json(suggested_name: String, content: String) -> Result<bool, String> {
    let Some(handle) = rfd::AsyncFileDialog::new()
        .add_filter("JSON Files", &["json"])
        .set_file_name(&suggested_name)
        .save_file()
        .await
    else {
        return Ok(false);
    };
    fs::write(handle.path(), content).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Returns the chosen file's *contents*, never a filesystem path — the webview has no business
/// holding one, and an earlier port that returned the path had the renderer trying to `JSON.parse` it.
#[tauri::command]
pub async fn import_json() -> Result<Option<String>, String> {
    let Some(handle) = rfd::AsyncFileDialog::new()
        .add_filter("JSON Files", &["json"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    Ok(Some(read_bounded(handle.path())?))
}

#[tauri::command]
pub async fn import_file() -> Result<Option<Value>, String> {
    let Some(handle) = rfd::AsyncFileDialog::new()
        .add_filter("JSON Files", &["json"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let text = read_bounded(handle.path())?;
    Ok(Some(import_outcome_to_value(parse_import_content(&text)?)))
}
