//! Opens OmniTerm's active workspace as the project of the embedded IDE backend (`ide_app`).
//!
//! OmniTerm's workspaces (a name and a list of pinned folders) are the only way the user picks what
//! the workbench works on. The IDE backend keeps one project per window:
//! - no folder: the window has no project;
//! - one folder: that folder is the project;
//! - several folders: an IDE *container* workspace (a folder holding only
//!   `.omniterm/workspace.json`) kept in the app's data directory lists them, and is the project.

use std::path::{Path, PathBuf};

use ide_app::state::AppState;
use ide_core::{IdeError, IdeResult};
use ide_host::ops::project::ProjectInfo;
use ide_workspace::workspace::Workspace;
use tauri::{Manager, Runtime, WebviewWindow};

/// What the window's project becomes for a workspace's folders.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ProjectPlan {
    Close,
    Folder(PathBuf),
    Container {
        root: PathBuf,
        name: String,
        projects: Vec<PathBuf>,
    },
}

/// The container directory of workspace `id`: one per workspace, named after its id with every
/// character outside `[A-Za-z0-9_-]` replaced, so an id can never leave `containers`.
pub(crate) fn container_dir(containers: &Path, id: &str) -> PathBuf {
    let safe: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    containers.join(if safe.is_empty() {
        "_".to_owned()
    } else {
        safe
    })
}

pub(crate) fn plan(containers: &Path, id: &str, name: &str, folders: Vec<PathBuf>) -> ProjectPlan {
    match folders.len() {
        0 => ProjectPlan::Close,
        1 => ProjectPlan::Folder(folders.into_iter().next().unwrap_or_default()),
        _ => {
            let trimmed = name.trim();
            ProjectPlan::Container {
                root: container_dir(containers, id),
                name: if trimmed.is_empty() {
                    "Workspace".to_owned()
                } else {
                    trimmed.replace(['\r', '\n'], " ")
                },
                projects: folders,
            }
        }
    }
}

/// Writes (or rewrites) the container's workspace file so it lists exactly `projects`.
pub(crate) fn write_container(root: &Path, name: &str, projects: Vec<PathBuf>) -> IdeResult<()> {
    std::fs::create_dir_all(root)?;
    let exists = Workspace::load(root)?.is_some();
    Workspace::save(root, name, projects, !exists)?;
    Ok(())
}

/// Whether every folder of a workspace is trusted. A folder whose trust cannot be read counts as
/// untrusted, so a container never ends up trusted by mistake.
pub(crate) fn all_trusted(folders: &[PathBuf], trusted: impl Fn(&Path) -> IdeResult<bool>) -> bool {
    !folders.is_empty()
        && folders
            .iter()
            .all(|folder| trusted(folder).unwrap_or(false))
}

fn same_path(a: &Path, b: &Path) -> bool {
    match (dunce::canonicalize(a), dunce::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// The folders that make up the project. A disabled folder stays in the project, so switching a
/// folder off or on never reopens it: the Project panel shows it greyed out and OmniTerm's own
/// scans skip it. A workspace whose folders are all switched off has no project.
pub(crate) fn project_folders(workspace: &app_protocol::workspace::Workspace) -> Vec<PathBuf> {
    if app_core::workspace_model::active_folders(workspace)
        .next()
        .is_none()
    {
        return Vec::new();
    }
    workspace
        .folders
        .iter()
        .map(|folder| PathBuf::from(&folder.path))
        .collect()
}

/// Marks the workspace the workbench works on (or clears it) and returns its project. Not part of
/// the `ide_app` command set: the OmniTerm webview calls it whenever its active workspace changes.
#[tauri::command]
pub async fn ide_set_project<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: Option<String>,
) -> IdeResult<Option<ProjectInfo>> {
    let app = window.app_handle().clone();
    let label = window.label().to_owned();
    let containers = app
        .path()
        .app_local_data_dir()
        .map_err(|error| IdeError::internal(format!("no app data directory: {error}")))?
        .join("workspaces");
    let step = match workspace_id {
        None => ProjectPlan::Close,
        Some(id) => {
            let workspaces =
                crate::workspace_persistence::read_workspaces(&app).map_err(IdeError::internal)?;
            let workspace = workspaces
                .into_iter()
                .find(|workspace| workspace.id == id)
                .ok_or_else(|| IdeError::not_found(format!("no workspace {id}")))?;
            let folders = project_folders(&workspace);
            plan(&containers, &id, &workspace.name, folders)
        }
    };
    tauri::async_runtime::spawn_blocking(move || {
        let state = app
            .try_state::<AppState>()
            .ok_or_else(|| IdeError::internal("the IDE backend is not running"))?;
        let root = match step {
            ProjectPlan::Close => {
                state.close_project(&label);
                return Ok(None);
            }
            ProjectPlan::Folder(root) => root,
            ProjectPlan::Container {
                root,
                name,
                projects,
            } => {
                let members_trusted = all_trusted(&projects, |path| state.host.trust.trusted(path));
                write_container(&root, &name, projects)?;
                // The container is OmniTerm's own metadata folder; it is as trustworthy as the
                // folders it lists. Trusted for this process only, never recorded as a decision.
                if members_trusted {
                    state.host.trust.inherit(&root)?;
                }
                root
            }
        };
        // Re-selecting the open project keeps it, its editors and its language servers.
        if let Ok(current) = state.project(&label) {
            if same_path(&current.root, &root) {
                return Ok(Some(ide_host::ops::project::info(&current)));
            }
        }
        let project = state.open_project(&label, &root)?;
        Ok(Some(ide_host::ops::project::info(&project)))
    })
    .await
    .map_err(|error| IdeError::internal(format!("task failed: {error}")))?
}

#[cfg(test)]
#[path = "project_bridge_tests.rs"]
mod tests;
