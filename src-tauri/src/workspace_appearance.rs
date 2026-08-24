use crate::workspace::{read_workspaces, write_workspaces, Workspace};
use tauri::{AppHandle, Runtime};

pub(crate) const WORKSPACE_COLORS: &[&str] = &[
    "red", "orange", "yellow", "green", "blue", "purple", "pink", "gray",
];
pub(crate) const WORKSPACE_ICONS: &[&str] =
    &["folder", "briefcase", "layers", "code", "server", "star"];

pub(crate) fn normalize_appearance_value(
    value: Option<String>,
    allowed: &[&str],
    label: &str,
) -> Result<Option<String>, String> {
    value
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            if allowed.contains(&normalized.as_str()) {
                Ok(normalized)
            } else {
                Err(format!("Unknown workspace {label} \"{value}\"."))
            }
        })
        .transpose()
}

#[tauri::command]
pub async fn set_workspace_appearance<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    color: Option<String>,
    icon: Option<String>,
) -> Result<Workspace, String> {
    let color = normalize_appearance_value(color, WORKSPACE_COLORS, "color")?;
    let icon = normalize_appearance_value(icon, WORKSPACE_ICONS, "icon")?;
    let mut list = read_workspaces(&app)?;
    let workspace = list
        .iter_mut()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| format!("Unknown workspace \"{workspace_id}\""))?;
    workspace.color = color;
    workspace.icon = icon;
    let result = workspace.clone();
    write_workspaces(&app, &list)?;
    Ok(result)
}

#[tauri::command]
pub async fn set_workspace_folder_color<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    folder_id: String,
    color: Option<String>,
) -> Result<Workspace, String> {
    let color = normalize_appearance_value(color, WORKSPACE_COLORS, "color")?;
    let mut list = read_workspaces(&app)?;
    let workspace = list
        .iter_mut()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| format!("Unknown workspace \"{workspace_id}\""))?;
    let folder = workspace
        .folders
        .iter_mut()
        .find(|folder| folder.id == folder_id)
        .ok_or_else(|| format!("Unknown workspace folder \"{folder_id}\""))?;
    folder.color = color;
    let result = workspace.clone();
    write_workspaces(&app, &list)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appearance_values_are_trimmed_and_validated() {
        assert_eq!(
            normalize_appearance_value(Some(" BLUE ".to_string()), WORKSPACE_COLORS, "color")
                .unwrap(),
            Some("blue".to_string()),
        );
        assert_eq!(
            normalize_appearance_value(None, WORKSPACE_ICONS, "icon").unwrap(),
            None,
        );
        let error =
            normalize_appearance_value(Some("rainbow".to_string()), WORKSPACE_COLORS, "color")
                .expect_err("unknown appearance values must be rejected");
        assert!(error.contains("Unknown workspace color"));
    }
}
