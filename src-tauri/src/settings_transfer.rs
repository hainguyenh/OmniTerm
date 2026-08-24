//! Settings transfer: one versioned JSON envelope carrying every user-facing store.
//!
//! Sections: `appSettings` (raw settings.json), `connections` (folder tree — **no credentials exist
//! in this store by design**, see the module doc on `connections.rs`; a defensive round-trip through
//! `ConnectionTree` also drops any legacy secret key a foreign file may contain), `themes` (the
//! *user* theme directory only, never bundled built-ins), and `workspaces` (catalog).
//!
//! Per-session persistence policies live in the renderer's localStorage, not in any backend store,
//! so they are stitched in and applied by the webview around these commands.
//!
//! Import is strictly versioned (`version == 1`) and fails closed: an unknown section key or a
//! wrong version aborts before any store is touched.

use crate::connections;
use crate::settings::{merge_shallow, read_settings};
use crate::themes;
use crate::workspace_persistence;
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};

#[cfg(test)]
#[path = "settings_transfer_tests.rs"]
mod tests;

const ENVELOPE_VERSION: u64 = 1;
const KNOWN_SECTIONS: [&str; 4] = ["appSettings", "connections", "themes", "workspaces"];

/// Serialize one envelope containing every backend-backed section.
#[tauri::command]
pub async fn export_settings<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let tree = connections::read_tree(&app)?;
    Ok(json!({
        "version": ENVELOPE_VERSION,
        "exportedAt": chrono_now_rfc3339(),
        "sections": {
            "appSettings": read_settings(&app),
            "connections": serde_json::to_value(&tree).map_err(|e| e.to_string())?,
            "themes": themes::user_theme_files(&app)?,
            "workspaces": workspace_persistence::read_workspaces(&app)
                .map_err(|e| e.to_string())?,
        },
    }))
}

/// Apply an envelope's sections. `strategy` is `"merge"` (existing values win, new entries append)
/// or `"replace"` (incoming wins outright). Returns a per-section imported-count report.
#[tauri::command]
pub async fn import_settings<R: Runtime>(
    app: AppHandle<R>,
    envelope: Value,
    strategy: String,
) -> Result<Value, String> {
    if envelope["version"] != json!(ENVELOPE_VERSION) {
        return Err(format!(
            "Unsupported settings envelope version {} (expected {ENVELOPE_VERSION}).",
            envelope["version"]
        ));
    }
    let replace = match strategy.as_str() {
        "merge" => false,
        "replace" => true,
        other => return Err(format!("Unknown import strategy '{other}'.")),
    };
    let sections = envelope
        .get("sections")
        .and_then(Value::as_object)
        .ok_or_else(|| "Envelope is missing its 'sections' object.".to_string())?;
    for key in sections.keys() {
        if !KNOWN_SECTIONS.contains(&key.as_str()) {
            return Err(format!("Unknown section '{key}' — refusing to import."));
        }
    }

    // Validate everything before writing anything: a bad theme id must not leave a half-imported
    // settings file behind.
    let incoming_settings = sections.get("appSettings").cloned();
    if let Some(patch) = &incoming_settings {
        if !patch.is_object() {
            return Err("Section 'appSettings' must be an object.".to_string());
        }
    }
    let incoming_connections = match sections.get("connections") {
        Some(raw) => Some(
            serde_json::from_value::<connections::ConnectionTree>(raw.clone())
                .map_err(|e| format!("Rejected connection tree: {e}"))?,
        ),
        None => None,
    };
    let incoming_themes = match sections.get("themes") {
        Some(list) => {
            for theme in list.as_array().ok_or("'themes' must be an array")? {
                themes::validate_theme_id(
                    theme
                        .get("id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| "A theme entry is missing its string 'id'.".to_string())?,
                )?;
            }
            Some(list.clone())
        }
        None => None,
    };
    let incoming_workspaces = match sections.get("workspaces") {
        Some(list) => Some(
            serde_json::from_value::<Vec<app_protocol::workspace::Workspace>>(list.clone())
                .map_err(|e| format!("Rejected workspace catalog: {e}"))?,
        ),
        None => None,
    };

    let mut report = serde_json::Map::new();

    if let Some(patch) = incoming_settings {
        let base = if replace {
            crate::settings::defaults()
        } else {
            read_settings(&app)
        };
        crate::settings::write_settings_raw(&app, merge_shallow(&base, &patch))?;
        report.insert("appSettings".into(), json!(1));
    }

    if let Some(tree) = incoming_connections {
        connections::write_tree(&app, &tree)?;
        report.insert("connections".into(), json!(tree.connections.len()));
    }

    if let Some(list) = incoming_themes {
        let entries = list.as_array().expect("validated array");
        if replace {
            themes::clear_user_themes(&app)?;
        }
        for theme in entries {
            themes::write_user_theme(&app, theme.clone())?;
        }
        report.insert("themes".into(), json!(entries.len()));
    }

    if let Some(list) = incoming_workspaces {
        let final_list = if replace {
            list
        } else {
            let existing = workspace_persistence::read_workspaces(&app)?;
            let mut merged = existing;
            for workspace in list {
                if !merged.iter().any(|w| w.id == workspace.id) {
                    merged.push(workspace);
                }
            }
            merged
        };
        let count = final_list.len();
        workspace_persistence::write_workspaces(&app, &final_list)?;
        report.insert("workspaces".into(), json!(count));
    }

    Ok(json!({ "imported": Value::Object(report) }))
}

/// Wall-clock timestamp in RFC 3339. Hand-rolled because the workspace pulls no chrono
/// dependency and seconds precision is all the envelope needs.
fn chrono_now_rfc3339() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Days since epoch to y-m-d (Howard Hinnant's civil-from-days algorithm).
    let days = i64::try_from(secs / 86_400).unwrap_or(0);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    let rem = secs % 86_400;
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}
