//! Git domain services for OmniTerm.
//!
//! Executes git commands via system CLI, providing high-performance parsing
//! of repository status (porcelain v2), on-demand diffs, commit actions,
//! and commit log history without Tauri or GUI dependencies.

use app_protocol::git::{GitBlameLine, GitCommitSummary};
use std::path::{Path, PathBuf};
use std::process::Command;

pub use crate::git_branch::*;
pub use crate::git_branch_tools::*;
pub use crate::git_diff::*;
pub use crate::git_history::*;
pub use crate::git_stash::*;
pub use crate::git_status::*;

/// Resolves the Git executable path across common Windows installation paths and PATH.
pub fn resolve_git_binary() -> PathBuf {
    #[cfg(windows)]
    {
        let candidates = [
            r"C:\Program Files\Git\cmd\git.exe",
            r"C:\Program Files\Git\bin\git.exe",
            r"C:\Program Files (x86)\Git\cmd\git.exe",
            r"C:\Program Files (x86)\Git\bin\git.exe",
        ];
        for candidate in &candidates {
            let p = PathBuf::from(candidate);
            if p.exists() {
                return p;
            }
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let p = PathBuf::from(local_app_data).join(r"Programs\Git\cmd\git.exe");
            if p.exists() {
                return p;
            }
        }
        if let Ok(prog_files) = std::env::var("ProgramFiles") {
            let p = PathBuf::from(prog_files).join(r"Git\cmd\git.exe");
            if p.exists() {
                return p;
            }
        }
    }
    PathBuf::from("git")
}

/// Creates a standard Git Command configured with non-interactive flags and without console windows on Windows.
pub(crate) fn create_git_cmd(cwd: &Path, args: &[&str]) -> Command {
    let binary = resolve_git_binary();
    let mut cmd = Command::new(binary);
    cmd.args(args);
    cmd.current_dir(cwd);
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.env("GIT_PAGER", "cat");
    cmd.env("GIT_OPTIONAL_LOCKS", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Runs a git command in the specified directory and returns stdout if successful.
pub(crate) fn run_git_cmd(cwd: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    if !cwd.exists() {
        return Err(format!("Directory does not exist: {}", cwd.display()));
    }
    let actual_dir = if cwd.is_file() {
        cwd.parent().unwrap_or(cwd)
    } else {
        cwd
    };

    let mut full_args = vec!["--no-pager"];
    full_args.extend_from_slice(args);

    let output = create_git_cmd(actual_dir, &full_args)
        .output()
        .map_err(|e| {
            format!(
                "Failed to execute git {}: {}",
                args.first().unwrap_or(&""),
                e
            )
        })?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err_msg.is_empty() {
            format!(
                "git {:?} failed with exit code {:?}",
                args,
                output.status.code()
            )
        } else {
            err_msg
        });
    }

    Ok(output.stdout)
}

/// Stages specific file paths (`git add -- <paths>`).
pub fn stage_paths(repo_root: &Path, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = vec!["add", "--"];
    for p in paths {
        args.push(p.as_str());
    }
    run_git_cmd(repo_root, &args)?;
    Ok(())
}

/// Unstages specific file paths (`git restore --staged -- <paths>`).
pub fn unstage_paths(repo_root: &Path, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = vec!["restore", "--staged", "--"];
    for p in paths {
        args.push(p.as_str());
    }
    run_git_cmd(repo_root, &args)?;
    Ok(())
}

/// Reverts modified file paths or removes untracked files.
pub fn revert_paths(repo_root: &Path, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut restore_args = vec!["restore", "--"];
    for p in paths {
        restore_args.push(p.as_str());
    }
    let _ = run_git_cmd(repo_root, &restore_args);

    let mut clean_args = vec!["clean", "-f", "--"];
    for p in paths {
        clean_args.push(p.as_str());
    }
    let _ = run_git_cmd(repo_root, &clean_args);
    Ok(())
}

/// Creates a commit with the specified message.
pub fn commit(repo_root: &Path, message: &str, amend: bool) -> Result<String, String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("Commit message cannot be empty".into());
    }
    let mut args = vec!["commit", "-m", trimmed];
    if amend {
        args.push("--amend");
    }
    let stdout = run_git_cmd(repo_root, &args)?;
    Ok(String::from_utf8_lossy(&stdout).to_string())
}

/// Fetches recent commit log entries formatted for visual graph rendering.
pub fn get_commit_log(repo_root: &Path, limit: usize) -> Result<Vec<GitCommitSummary>, String> {
    let limit_str = limit.to_string();
    let format_arg = "--format=%H\x1f%h\x1f%s\x1f%an\x1f%ae\x1f%at\x1f%P\x1e";
    let stdout = run_git_cmd(repo_root, &["log", "-n", &limit_str, format_arg])?;
    let text = String::from_utf8_lossy(&stdout);

    let mut list = Vec::new();
    for record in text.split('\x1e') {
        let trimmed = record.trim();
        if trimmed.is_empty() {
            continue;
        }
        let fields: Vec<&str> = trimmed.split('\x1f').collect();
        if fields.len() >= 7 {
            let parents: Vec<String> = fields[6]
                .split_whitespace()
                .map(|p| p.to_string())
                .collect();
            list.push(GitCommitSummary {
                id: fields[0].to_string(),
                short_id: fields[1].to_string(),
                summary: fields[2].to_string(),
                author_name: fields[3].to_string(),
                author_email: fields[4].to_string(),
                timestamp: fields[5].parse().unwrap_or(0),
                parents,
            });
        }
    }

    Ok(list)
}

/// Retrieves git blame information for a file.
pub fn get_file_blame(repo_root: &Path, file_path: &str) -> Result<Vec<GitBlameLine>, String> {
    let normalized_path = file_path.replace('\\', "/");
    let stdout = run_git_cmd(repo_root, &["blame", "--date=short", "-s", "--", &normalized_path])?;
    let text = String::from_utf8_lossy(&stdout);
    let mut lines = Vec::new();
    for (idx, raw_line) in text.lines().enumerate() {
        let line_str = raw_line.to_string();
        if let Some(paren_pos) = line_str.find(')') {
            let meta = &line_str[..paren_pos];
            let content = if paren_pos + 1 < line_str.len() {
                line_str[paren_pos + 1..].trim_start_matches(' ').to_string()
            } else {
                String::new()
            };
            let parts: Vec<&str> = meta.split_whitespace().collect();
            let commit = parts.first().unwrap_or(&"").to_string();
            let author = if parts.len() >= 3 {
                parts[1..parts.len() - 2].join(" ").trim_start_matches('(').to_string()
            } else {
                String::new()
            };
            let date = if parts.len() >= 2 {
                parts[parts.len() - 2].to_string()
            } else {
                String::new()
            };
            lines.push(GitBlameLine {
                commit,
                author,
                date,
                line_no: (idx + 1) as u32,
                content,
            });
        } else {
            lines.push(GitBlameLine {
                commit: String::new(),
                author: String::new(),
                date: String::new(),
                line_no: (idx + 1) as u32,
                content: line_str,
            });
        }
    }
    Ok(lines)
}

/// Deletes a file either via `git rm -f` (if tracked) or by removing it from the filesystem.
pub fn delete_file(repo_root: &Path, file_path: &str) -> Result<(), String> {
    let normalized_path = file_path.replace('\\', "/");
    let full_path = repo_root.join(&normalized_path);
    let git_rm = run_git_cmd(repo_root, &["rm", "-f", "--", &normalized_path]);
    if git_rm.is_err() && full_path.exists() {
        if full_path.is_file() {
            std::fs::remove_file(&full_path).map_err(|e| format!("Failed to delete file: {}", e))?;
        } else if full_path.is_dir() {
            std::fs::remove_dir_all(&full_path).map_err(|e| format!("Failed to delete directory: {}", e))?;
        }
    }
    Ok(())
}

/// Safely reads the text content of a file within the repository.
pub fn read_file_content(repo_root: &Path, file_path: &str) -> Result<String, String> {
    let clean_path = file_path.replace('\\', "/");
    if clean_path.starts_with('/') || clean_path.contains("../") {
        return Err("Invalid path traversal".into());
    }
    let full = repo_root.join(&clean_path);
    std::fs::read_to_string(&full).map_err(|e| format!("Failed to read file: {}", e))
}

/// Safely writes text content to a file within the repository.
pub fn write_file_content(repo_root: &Path, file_path: &str, content: &str) -> Result<(), String> {
    let clean_path = file_path.replace('\\', "/");
    if clean_path.starts_with('/') || clean_path.contains("../") {
        return Err("Invalid path traversal".into());
    }
    let full = repo_root.join(&clean_path);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dirs: {}", e))?;
    }
    std::fs::write(&full, content).map_err(|e| format!("Failed to write file: {}", e))
}

/// Safely reads the text content of a file at a specific git revision (e.g. "HEAD", ":2", ":3").
pub fn read_file_revision(
    repo_root: &Path,
    file_path: &str,
    revision: &str,
) -> Result<String, String> {
    let clean_path = file_path.replace('\\', "/");
    if clean_path.starts_with('/') || clean_path.contains("../") {
        return Err("Invalid path traversal".into());
    }
    let target = format!("{}:{}", revision, clean_path);
    let stdout = run_git_cmd(repo_root, &["show", &target])?;
    Ok(String::from_utf8_lossy(&stdout).to_string())
}

