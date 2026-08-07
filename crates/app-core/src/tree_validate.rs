//! Schema validation and bounds for an imported `{folders, connections}` tree.
//!
//! This was `vault.rs` and also held scrypt + AES-256-GCM for encrypted backups. The crypto is gone
//! with the credentials it protected: the app stores no secret, so a backup carries nothing worth
//! encrypting and shipping a cipher would only imply otherwise. What remains is the part that always
//! mattered — an import is attacker-influenced input (the user may have been handed the file), so it
//! is validated and rejected outright rather than coerced.

use app_protocol::shell_spec::LocalShell;
use serde_json::Value;

/// Cap on an imported file, applied before the bytes are read so a crafted oversized file cannot
/// exhaust memory.
pub const MAX_IMPORT_FILE_BYTES: u64 = 5 * 1024 * 1024;

/// Record/field bounds on an imported tree.
const MAX_RECORDS: usize = 10_000;
const MAX_NAME_LENGTH: usize = 256;
const MAX_ID_LENGTH: usize = 128;
const MAX_LOCAL_FIELD_LENGTH: usize = 4096;

#[cfg(test)]
#[path = "tree_validate_tests.rs"]
mod tests;

fn as_str_field(record: &Value, key: &str) -> Option<String> {
    record.get(key).and_then(|v| v.as_str()).map(str::to_owned)
}

fn check_optional_string(record: &Value, key: &str, max: usize) -> Result<(), String> {
    match record.get(key) {
        None | Some(Value::Null) => Ok(()),
        Some(Value::String(s)) if s.len() <= max => Ok(()),
        _ => Err(format!("Rejected: invalid connection {key}.")),
    }
}

/// Schema-validate and bound an imported `{folders, connections}` pair before it reaches the app.
///
/// Note what is *not* checked: a `password` key. It used to be length-bounded here, which implicitly
/// blessed it as part of the schema. It is now neither validated nor rejected — `parse_import_content`
/// strips it structurally before the tree reaches the webview, so a file carrying one still imports
/// its connection metadata and simply arrives without the secret.
pub fn validate_tree(folders: &Value, connections: &Value) -> Result<(), String> {
    let (folders, connections) = match (folders.as_array(), connections.as_array()) {
        (Some(f), Some(c)) => (f, c),
        _ => return Err(r#"Rejected: expected "folders" and "connections" arrays."#.to_string()),
    };
    if folders.len() > MAX_RECORDS || connections.len() > MAX_RECORDS {
        return Err(format!(
            "Rejected: too many records (max {MAX_RECORDS} per list)."
        ));
    }

    for f in folders {
        if !f.is_object() {
            return Err("Rejected: malformed folder record.".to_string());
        }
        match as_str_field(f, "id") {
            Some(id) if !id.is_empty() && id.len() <= MAX_ID_LENGTH => {}
            _ => return Err("Rejected: invalid folder id.".to_string()),
        }
        match as_str_field(f, "name") {
            Some(name) if name.len() <= MAX_NAME_LENGTH => {}
            _ => return Err("Rejected: invalid folder name.".to_string()),
        }
        if let Some(v) = f.get("parentId") {
            if !v.is_null() && !matches!(v.as_str(), Some(s) if s.len() <= MAX_ID_LENGTH) {
                return Err("Rejected: invalid folder parentId.".to_string());
            }
        }
    }

    for c in connections {
        if !c.is_object() {
            return Err("Rejected: malformed connection record.".to_string());
        }
        match as_str_field(c, "id") {
            Some(id) if !id.is_empty() && id.len() <= MAX_ID_LENGTH => {}
            _ => return Err("Rejected: invalid connection id.".to_string()),
        }
        match as_str_field(c, "name") {
            Some(name) if name.len() <= MAX_NAME_LENGTH => {}
            _ => return Err("Rejected: invalid connection name.".to_string()),
        }
        let conn_type = as_str_field(c, "type").unwrap_or_default();
        if !matches!(conn_type.as_str(), "SSH" | "RDP" | "LOCAL") {
            return Err(format!(
                "Rejected: invalid connection type \"{conn_type}\"."
            ));
        }
        // A saved shell must stay inside the closed set; an arbitrary string here would otherwise
        // reach the PTY the next time the user opened this connection.
        //
        // Checked against `LocalShell::parse` — the same set the spawner accepts — rather than
        // Electron's hard-coded `wsl|powershell|cmd`. That list was Windows-only, but the connection
        // form offers `default`/`zsh`/`bash`/`sh` on macOS, so validating against it rejected every
        // LOCAL connection a Mac user tried to save. Deliberately platform-agnostic: a Windows backup
        // restored on a Mac imports fine and is refused later, with a clear message, only if the user
        // actually opens it.
        if let Some(v) = c.get("shell") {
            if !v.is_null() && !matches!(v.as_str(), Some(s) if LocalShell::parse(s).is_some()) {
                return Err(format!(
                    "Rejected: invalid connection shell \"{}\".",
                    v.as_str().unwrap_or("?")
                ));
            }
        }
        for field in ["localArgs", "localCwd", "localCommand"] {
            check_optional_string(c, field, MAX_LOCAL_FIELD_LENGTH)?;
        }
        for field in ["localKeepOpen", "redirectDrives"] {
            match c.get(field) {
                None | Some(Value::Null) | Some(Value::Bool(_)) => {}
                _ => return Err(format!("Rejected: connection {field} must be a boolean.")),
            }
        }
    }

    Ok(())
}
