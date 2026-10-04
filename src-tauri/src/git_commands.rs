//! Git Tauri command endpoints.
//!
//! Provides async wrappers connecting the React UI to Git core domain operations.

use app_protocol::git::{
    GitBlameLine, GitBranchComparison, GitBranchInfo, GitCommitSummary,
    GitDeleteBranchesResult, GitFileDiff, GitFileHistoryEntry, GitRepoStatus, GitStashEntry,
};
use std::path::PathBuf;

#[tauri::command]
pub async fn git_status(cwd: String) -> Result<GitRepoStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::get_repo_status(&repo_root)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_diff(cwd: String, file_path: String, staged: bool) -> Result<GitFileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::get_file_diff(&repo_root, &file_path, staged)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_stage(cwd: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::stage_paths(&repo_root, &paths)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_unstage(cwd: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::unstage_paths(&repo_root, &paths)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_revert(cwd: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::revert_paths(&repo_root, &paths)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_commit(cwd: String, message: String, amend: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::commit(&repo_root, &message, amend)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_log(cwd: String, limit: Option<usize>) -> Result<Vec<GitCommitSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::get_commit_log(&repo_root, limit.unwrap_or(50))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_branches(cwd: String) -> Result<Vec<GitBranchInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::get_branches(&repo_root)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_checkout(cwd: String, branch: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::checkout_branch(&repo_root, &branch)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_create_branch(
    cwd: String,
    name: String,
    start_point: Option<String>,
    checkout: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::create_branch(&repo_root, &name, start_point.as_deref(), checkout)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_delete_branches(
    cwd: String,
    branches: Vec<String>,
    force: bool,
) -> Result<GitDeleteBranchesResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git_branch::delete_branches(&repo_root, &branches, force)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_fetch(cwd: String, prune: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::fetch_repo(&repo_root, prune)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_pull(cwd: String, rebase: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::pull_repo(&repo_root, rebase)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_push(cwd: String, set_upstream: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::push_repo(&repo_root, set_upstream)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_merge(cwd: String, branch: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::merge_branch(&repo_root, &branch)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_rebase(cwd: String, branch: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::rebase_branch(&repo_root, &branch)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_init(cwd: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        app_core::git::init_repo(&path)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_diff_branch(
    cwd: String,
    file_path: String,
    branch: String,
) -> Result<GitFileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::get_file_diff_against_ref(&repo_root, &file_path, &branch)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_blame(cwd: String, file_path: String) -> Result<Vec<GitBlameLine>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::get_file_blame(&repo_root, &file_path)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_delete_file(cwd: String, file_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::delete_file(&repo_root, &file_path)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_read_file(cwd: String, file_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::read_file_content(&repo_root, &file_path)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_read_file_revision(cwd: String, file_path: String, revision: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::read_file_revision(&repo_root, &file_path, &revision)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_write_file(cwd: String, file_path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::write_file_content(&repo_root, &file_path, &content)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_compare_branches(
    cwd: String,
    base_branch: String,
    target_branch: String,
) -> Result<GitBranchComparison, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::compare_branches(&repo_root, &base_branch, &target_branch)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_stash_list(cwd: String) -> Result<Vec<GitStashEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::stash_list(&repo_root)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_stash_save(
    cwd: String,
    message: Option<String>,
    keep_index: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::stash_save(&repo_root, message.as_deref(), keep_index)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_stash_pop(cwd: String, index: Option<usize>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::stash_pop(&repo_root, index)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_stash_apply(cwd: String, index: Option<usize>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::stash_apply(&repo_root, index)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_stash_drop(cwd: String, index: usize) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::stash_drop(&repo_root, index)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn git_cherry_pick(cwd: String, commit_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        app_core::git::cherry_pick(&repo_root, &commit_id)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Commits that touched one file, or only lines `start_line..=end_line` of it when both are given.
#[tauri::command]
pub async fn git_file_history(
    cwd: String,
    file_path: String,
    start_line: Option<u32>,
    end_line: Option<u32>,
    limit: Option<usize>,
) -> Result<Vec<GitFileHistoryEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&cwd);
        let repo_root = app_core::git::find_repo_root(&path)?;
        let lines = start_line.zip(end_line);
        let limit = limit.unwrap_or(app_core::git::DEFAULT_HISTORY_LIMIT);
        app_core::git::get_file_history(&repo_root, &file_path, lines, limit)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}
