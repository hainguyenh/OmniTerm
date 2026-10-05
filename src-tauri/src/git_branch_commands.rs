//! Tauri endpoints for branch maintenance that leaves the working tree alone: update without
//! checkout, rename, upstream changes and worktrees. Thin wrappers over `app_core::git_branch_tools`
//! and `app_core::git_worktree`.

use app_protocol::git::GitWorktreeInfo;
use std::path::{Path, PathBuf};

/// Runs `op` on the blocking pool — git is a child process, and the IPC thread must not wait on it.
pub(crate) async fn on_blocking_pool<T, F>(op: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(op)
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

/// Runs `op` against the repository containing `cwd` on the blocking pool.
pub(crate) async fn in_repo<T, F>(cwd: String, op: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Path) -> Result<T, String> + Send + 'static,
{
    on_blocking_pool(move || {
        let repo_root = app_core::git::find_repo_root(&PathBuf::from(&cwd))?;
        op(&repo_root)
    })
    .await
}

#[tauri::command]
pub async fn git_update_branch(cwd: String, branch: String) -> Result<String, String> {
    in_repo(cwd, move |root| {
        app_core::git::update_branch_without_checkout(root, &branch)
    })
    .await
}

#[tauri::command]
pub async fn git_rename_branch(
    cwd: String,
    branch: String,
    new_name: String,
) -> Result<String, String> {
    in_repo(cwd, move |root| {
        app_core::git::rename_branch(root, &branch, &new_name)
    })
    .await
}

#[tauri::command]
pub async fn git_set_upstream(
    cwd: String,
    branch: String,
    upstream: Option<String>,
) -> Result<String, String> {
    in_repo(cwd, move |root| {
        app_core::git::set_branch_upstream(root, &branch, upstream.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn git_add_worktree(
    cwd: String,
    branch: String,
    path: Option<String>,
) -> Result<String, String> {
    in_repo(cwd, move |root| {
        app_core::git::add_worktree(root, &branch, path.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn git_worktrees(cwd: String) -> Result<Vec<GitWorktreeInfo>, String> {
    in_repo(cwd, app_core::git::list_worktrees).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::async_runtime::block_on;

    #[test]
    fn commands_resolve_the_repository_and_surface_core_errors() {
        // Spawns `git`: hold the test lock so no other test has `PATH` swapped out meanwhile.
        let _guard = crate::test_support::lock();
        let manifest_dir = env!("CARGO_MANIFEST_DIR").to_string();
        let invalid = block_on(git_rename_branch(
            manifest_dir.clone(),
            "-x".into(),
            "y".into(),
        ));
        assert!(invalid.unwrap_err().contains("'-'"));
        let upstream = block_on(git_set_upstream(manifest_dir.clone(), "-x".into(), None));
        assert!(upstream.is_err());
        let update = block_on(git_update_branch(manifest_dir.clone(), "--all".into()));
        assert!(update.is_err());
        let worktree = block_on(git_add_worktree(
            manifest_dir,
            "no/such/branch-xyz".into(),
            None,
        ));
        assert!(worktree.unwrap_err().contains("Unknown branch"));
        let listed = block_on(git_worktrees(env!("CARGO_MANIFEST_DIR").to_string()))
            .expect("the source checkout lists its worktrees");
        assert!(listed.first().is_some_and(|main| main.is_main));
        assert_eq!(listed.iter().filter(|wt| wt.is_current).count(), 1);

        let outside = tempfile::tempdir().expect("temp dir");
        let not_repo = block_on(git_update_branch(
            outside.path().to_string_lossy().into_owned(),
            "main".into(),
        ));
        assert!(not_repo.is_err());
        let no_worktrees = block_on(git_worktrees(outside.path().to_string_lossy().into_owned()));
        assert!(no_worktrees.is_err());
    }
}
