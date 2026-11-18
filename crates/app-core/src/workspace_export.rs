//! A workspace written as a VS Code `.code-workspace` file, the counterpart of `parse_workspace_import`.

use app_protocol::workspace::Workspace;
use serde_json::json;

/// The JSON of a `.code-workspace` holding the workspace's folders that are switched on. A folder
/// whose name is just the last segment of its path is written without a `name`, as VS Code does.
pub fn to_code_workspace(workspace: &Workspace) -> Result<String, String> {
    let folders: Vec<_> = workspace
        .folders
        .iter()
        .filter(|folder| !folder.disabled)
        .map(|folder| {
            let leaf = folder
                .path
                .trim_end_matches(['/', '\\'])
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or_default();
            if folder.name == leaf {
                json!({ "path": folder.path })
            } else {
                json!({ "name": folder.name, "path": folder.path })
            }
        })
        .collect();
    if folders.is_empty() {
        return Err("The workspace has no enabled project folders to export.".to_string());
    }
    serde_json::to_string_pretty(&json!({ "folders": folders, "settings": {} }))
        .map_err(|error| format!("Cannot write the workspace file: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_protocol::workspace::WorkspaceFolder;

    fn folder(name: &str, path: &str, disabled: bool) -> WorkspaceFolder {
        WorkspaceFolder {
            id: format!("folder#{name}"),
            name: name.to_string(),
            path: path.to_string(),
            color: None,
            disabled,
        }
    }

    fn workspace(folders: Vec<WorkspaceFolder>) -> Workspace {
        Workspace {
            id: "w".to_string(),
            name: "dev".to_string(),
            folders,
            parent_id: None,
            order: 0,
            pins: Vec::new(),
            color: None,
            icon: None,
        }
    }

    #[test]
    fn writes_enabled_folders_and_names_only_when_they_differ_from_the_path() {
        let text = to_code_workspace(&workspace(vec![
            folder("app", "D:\\work\\app", false),
            folder("Docs site", "D:\\work\\docs", false),
            folder("old", "D:\\work\\old", true),
        ]))
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            value["folders"],
            json!([
                { "path": "D:\\work\\app" },
                { "name": "Docs site", "path": "D:\\work\\docs" },
            ])
        );
    }

    #[test]
    fn refuses_a_workspace_with_nothing_enabled() {
        assert!(to_code_workspace(&workspace(vec![folder("a", "/a", true)])).is_err());
        assert!(to_code_workspace(&workspace(Vec::new())).is_err());
    }

    #[test]
    fn the_export_imports_back_to_the_same_folders() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path().join("app");
        std::fs::create_dir_all(&app).unwrap();
        let path = app.to_string_lossy().into_owned();
        let text = to_code_workspace(&workspace(vec![folder("app", &path, false)])).unwrap();
        let file = dir.path().join("dev.code-workspace");
        let imported = crate::workspace_model::parse_workspace_import(&file, &text).unwrap();
        assert_eq!(imported.name, "dev");
        assert_eq!(imported.folders.len(), 1);
    }
}
