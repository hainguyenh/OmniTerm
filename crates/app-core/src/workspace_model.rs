use app_protocol::workspace::{Workspace, WorkspaceFolder, WorkspaceImport, WorkspacePin};
use serde::Deserialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[cfg(test)]
#[path = "workspace_model_tests.rs"]
mod tests;

#[derive(Debug)]
pub struct DecodedWorkspaces {
    pub workspaces: Vec<Workspace>,
    pub migrated: bool,
}

#[derive(Debug)]
pub struct LogicalTarget<'a> {
    pub folder: &'a WorkspaceFolder,
    pub relative_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyWorkspace {
    id: String,
    name: String,
    path: String,
}

#[derive(Deserialize)]
struct EditorWorkspaceFile {
    #[serde(default)]
    folders: Vec<EditorWorkspaceFolder>,
}

#[derive(Deserialize)]
struct EditorWorkspaceFolder {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    path: Option<String>,
}

pub fn decode_workspaces(content: &str) -> Result<DecodedWorkspaces, String> {
    if content.trim().is_empty() {
        return Ok(DecodedWorkspaces { workspaces: Vec::new(), migrated: false });
    }
    let raw: Vec<serde_json::Value> = serde_json::from_str(content)
        .map_err(|error| format!("workspaces.json is corrupt ({error})."))?;
    let has_legacy_shape = raw
        .iter()
        .any(|item| item.get("path").is_some() && item.get("folders").is_none());
    if !has_legacy_shape {
        let workspaces: Vec<Workspace> = serde_json::from_value(serde_json::Value::Array(raw))
            .map_err(|error| format!("workspaces.json is corrupt ({error})."))?;
        validate_workspace_list(&workspaces)?;
        return Ok(DecodedWorkspaces { workspaces, migrated: false });
    }
    let legacy: Vec<LegacyWorkspace> = serde_json::from_value(serde_json::Value::Array(raw))
        .map_err(|error| format!("workspaces.json is corrupt ({error})."))?;
    let workspaces = legacy
        .into_iter()
        .enumerate()
        .map(|(order, item)| {
            let folder_id = format!("folder#{}", item.id.trim_start_matches("ws#"));
            Workspace {
                id: item.id,
                name: item.name,
                folders: vec![WorkspaceFolder {
                    id: folder_id,
                    name: display_name_for_path(Path::new(&item.path), &item.path),
                    path: item.path,
                    color: None,
                }],
                parent_id: None,
                order,
                pins: Vec::new(),
                color: None,
                icon: None,
            }
        })
        .collect::<Vec<_>>();
    validate_workspace_list(&workspaces)?;
    Ok(DecodedWorkspaces { workspaces, migrated: true })
}

pub fn validate_workspace_list(workspaces: &[Workspace]) -> Result<(), String> {
    let mut ids = HashSet::new();
    for workspace in workspaces {
        if workspace.id.trim().is_empty() || !ids.insert(workspace.id.as_str()) {
            return Err("Workspace ids must be non-empty and unique.".to_string());
        }
        let mut folder_ids = HashSet::new();
        for folder in &workspace.folders {
            if folder.id.trim().is_empty() || folder.path.trim().is_empty() {
                return Err(format!("Workspace \"{}\" has an invalid folder.", workspace.name));
            }
            if folder.id.contains('/') || folder.id.contains('\\') || !folder_ids.insert(folder.id.as_str()) {
                return Err(format!("Workspace \"{}\" has duplicate or invalid folder ids.", workspace.name));
            }
        }
        for pin in &workspace.pins {
            if !folder_ids.contains(pin.folder_id.as_str()) {
                return Err(format!("Workspace \"{}\" contains a pin for an unknown folder.", workspace.name));
            }
        }
    }
    for workspace in workspaces {
        if let Some(parent_id) = workspace.parent_id.as_deref() {
            if parent_id == workspace.id || !ids.contains(parent_id) {
                return Err(format!("Workspace \"{}\" has an invalid parent.", workspace.name));
            }
        }
        ensure_no_cycle(workspaces, &workspace.id, workspace.parent_id.as_deref())?;
    }
    Ok(())
}

pub fn parse_workspace_import(file_path: &Path, content: &str) -> Result<WorkspaceImport, String> {
    let extension = file_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != "code-workspace" && extension != "workspace" {
        return Err("Choose a .code-workspace or .workspace file.".to_string());
    }
    let parsed: EditorWorkspaceFile = serde_json::from_str(content)
        .map_err(|error| format!("Workspace file is invalid JSON ({error})."))?;
    let base = file_path.parent().unwrap_or_else(|| Path::new("."));
    let mut seen = HashSet::new();
    let mut folders = Vec::new();
    for item in parsed.folders {
        let Some(raw_path) = item.path.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) else {
            continue;
        };
        let candidate = resolve_import_path(base, &raw_path);
        let Ok(canonical) = dunce::canonicalize(&candidate) else {
            continue;
        };
        if !canonical.is_dir() {
            continue;
        }
        let normalized = canonical.to_string_lossy().into_owned();
        if !seen.insert(normalized.clone()) {
            continue;
        }
        let name = item
            .name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| display_name_for_path(&canonical, &normalized));
        folders.push(WorkspaceFolder {
            id: format!("folder#{}", folders.len() + 1),
            name,
            path: normalized,
            color: None,
        });
    }
    if folders.is_empty() {
        return Err("Workspace file contains no usable local folder paths.".to_string());
    }
    let name = file_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Imported workspace".to_string());
    Ok(WorkspaceImport { name, folders })
}

pub fn move_workspace(
    workspaces: &mut [Workspace],
    workspace_id: &str,
    parent_id: Option<&str>,
    index: usize,
) -> Result<(), String> {
    let moving_index = workspaces
        .iter()
        .position(|item| item.id == workspace_id)
        .ok_or_else(|| format!("Unknown workspace \"{workspace_id}\"."))?;
    if let Some(parent) = parent_id {
        if !workspaces.iter().any(|item| item.id == parent) {
            return Err(format!("Unknown parent workspace \"{parent}\"."));
        }
        if parent == workspace_id {
            return Err("A workspace cannot contain itself.".to_string());
        }
        ensure_no_cycle(workspaces, workspace_id, Some(parent))?;
    }
    let old_parent = workspaces[moving_index].parent_id.clone();
    workspaces[moving_index].parent_id = parent_id.map(str::to_string);
    normalize_siblings(workspaces, old_parent.as_deref(), None);
    normalize_siblings(workspaces, parent_id, Some((workspace_id, index)));
    Ok(())
}


pub fn normalize_workspace_orders(workspaces: &mut [Workspace]) {
    let parents = workspaces
        .iter()
        .map(|item| item.parent_id.clone())
        .collect::<HashSet<_>>();
    for parent in parents {
        normalize_siblings(workspaces, parent.as_deref(), None);
    }
}

/// Set a workspace folder's display alias. The path, id and every pin keep
/// resolving to the same directory — only the rendered name changes.
pub fn rename_folder(
    workspace: &mut Workspace,
    folder_id: &str,
    name: &str,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Folder name cannot be empty.".to_string());
    }
    let folder = workspace
        .folders
        .iter_mut()
        .find(|folder| folder.id == folder_id)
        .ok_or_else(|| format!("Unknown workspace folder \"{folder_id}\""))?;
    folder.name = name.to_string();
    Ok(())
}

pub fn set_entry_pinned(
    workspace: &mut Workspace,
    folder_id: &str,
    path: &str,
    pinned: bool,
) -> Result<(), String> {
    if !workspace.folders.iter().any(|folder| folder.id == folder_id) {
        return Err(format!("Unknown workspace folder \"{folder_id}\"."));
    }
    let normalized = path.trim_matches('/');
    workspace.pins.retain(|pin| !(pin.folder_id == folder_id && pin.path == normalized));
    if pinned {
        workspace.pins.push(WorkspacePin {
            folder_id: folder_id.to_string(),
            path: normalized.to_string(),
        });
    }
    Ok(())
}

pub fn is_entry_pinned(workspace: &Workspace, folder_id: &str, path: &str) -> bool {
    let normalized = path.trim_matches('/');
    workspace
        .pins
        .iter()
        .any(|pin| pin.folder_id == folder_id && pin.path == normalized)
}

pub fn logical_target<'a>(workspace: &'a Workspace, logical_path: &str) -> Result<LogicalTarget<'a>, String> {
    let trimmed = logical_path.trim_matches('/');
    let (folder_id, relative_path) = trimmed.split_once('/').unwrap_or((trimmed, ""));
    if folder_id.is_empty() {
        return Err("Choose a workspace folder first.".to_string());
    }
    let folder = workspace
        .folders
        .iter()
        .find(|folder| folder.id == folder_id)
        .ok_or_else(|| format!("Unknown workspace folder \"{folder_id}\"."))?;
    Ok(LogicalTarget { folder, relative_path: relative_path.to_string() })
}

pub fn namespace_path(folder_id: &str, relative_path: &str) -> String {
    let relative = relative_path.trim_matches('/');
    if relative.is_empty() {
        folder_id.to_string()
    } else {
        format!("{folder_id}/{relative}")
    }
}

fn resolve_import_path(base: &Path, raw: &str) -> PathBuf {
    let path = Path::new(raw);
    if path.is_absolute() { path.to_path_buf() } else { base.join(path) }
}

fn display_name_for_path(path: &Path, fallback: &str) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn ensure_no_cycle(workspaces: &[Workspace], workspace_id: &str, parent_id: Option<&str>) -> Result<(), String> {
    let mut cursor = parent_id;
    let mut visited = HashSet::new();
    while let Some(parent) = cursor {
        if parent == workspace_id {
            return Err("A workspace cannot be moved into one of its descendants.".to_string());
        }
        if !visited.insert(parent) {
            return Err("Workspace hierarchy contains a cycle.".to_string());
        }
        cursor = workspaces
            .iter()
            .find(|item| item.id == parent)
            .and_then(|item| item.parent_id.as_deref());
    }
    Ok(())
}

fn normalize_siblings(workspaces: &mut [Workspace], parent_id: Option<&str>, insertion: Option<(&str, usize)>) {
    let moving = insertion.map(|(id, _)| id);
    let mut indices = workspaces
        .iter()
        .enumerate()
        .filter(|(_, item)| item.parent_id.as_deref() == parent_id && Some(item.id.as_str()) != moving)
        .map(|(idx, _)| idx)
        .collect::<Vec<_>>();
    indices.sort_by_key(|idx| workspaces[*idx].order);
    if let Some((id, target)) = insertion {
        if let Some(moving_idx) = workspaces.iter().position(|item| item.id == id) {
            indices.insert(target.min(indices.len()), moving_idx);
        }
    }
    for (order, idx) in indices.into_iter().enumerate() {
        workspaces[idx].order = order;
    }
}
