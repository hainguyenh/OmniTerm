//! The folders Clean Up › Rust and Clean Up › Worktrees search: every enabled folder of every
//! workspace, plus folders the user added in the panel. Only searching starts from these paths;
//! what is removed later is limited to what a search found (see the two IPC modules).

use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

/// Folders a panel may add on top of the workspaces.
const MAX_EXTRA_ROOTS: usize = 32;

/// Workspace folders, then `extra`, each once.
pub(crate) fn scan_roots<R: Runtime>(
    app: &AppHandle<R>,
    extra: &[String],
) -> Result<Vec<PathBuf>, String> {
    let workspaces = crate::workspace_persistence::read_workspaces(app)?;
    let folders = workspaces
        .iter()
        .flat_map(|workspace| workspace.folders.iter())
        .filter(|folder| !folder.disabled)
        .map(|folder| PathBuf::from(&folder.path));
    merge_roots(folders, extra)
}

/// Workspace folders that still exist, then every `extra` folder, which must be an existing
/// absolute folder: a typo is reported rather than searched as nothing.
pub(crate) fn merge_roots(
    workspace: impl Iterator<Item = PathBuf>,
    extra: &[String],
) -> Result<Vec<PathBuf>, String> {
    if extra.len() > MAX_EXTRA_ROOTS {
        return Err(format!("At most {MAX_EXTRA_ROOTS} added folders."));
    }
    let mut roots: Vec<PathBuf> = workspace.filter(|path| path.is_dir()).collect();
    for raw in extra {
        let path = PathBuf::from(raw);
        if raw.chars().any(char::is_control) || !path.is_absolute() || !path.is_dir() {
            return Err(format!("\"{raw}\" is not a folder."));
        }
        roots.push(path);
    }
    let mut seen = std::collections::HashSet::new();
    roots.retain(|path| seen.insert(dunce::canonicalize(path).unwrap_or_else(|_| path.clone())));
    Ok(roots)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_existing_workspace_folders_and_valid_added_ones_once() {
        let dir = tempfile::tempdir().expect("temp dir");
        let here = dir.path().to_path_buf();
        let missing = here.join("missing");
        let roots = merge_roots(
            vec![here.clone(), missing].into_iter(),
            &[here.to_string_lossy().into_owned()],
        )
        .expect("valid roots");
        assert_eq!(roots, vec![here]);
    }

    #[test]
    fn refuses_an_added_path_that_is_not_an_absolute_folder() {
        for bad in [
            "relative/path",
            "C:\\definitely\\not\\here\\omniterm",
            "bad\nname",
        ] {
            assert!(
                merge_roots(std::iter::empty(), &[bad.to_string()]).is_err(),
                "{bad}"
            );
        }
        let too_many = vec![std::env::temp_dir().to_string_lossy().into_owned(); 33];
        assert!(merge_roots(std::iter::empty(), &too_many).is_err());
    }
}
