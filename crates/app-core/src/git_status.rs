//! Machine-readable porcelain v2 status parser and repo resolution for Git.

use crate::git::run_git_cmd;
use app_protocol::git::{GitFileChange, GitFileStatus, GitRepoStatus};
use std::path::{Path, PathBuf};

/// Finds the root directory of the git repository containing `path`.
pub fn find_repo_root(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }
    let actual_dir = if path.is_file() {
        path.parent().unwrap_or(path)
    } else {
        path
    };

    match run_git_cmd(actual_dir, &["rev-parse", "--show-toplevel"]) {
        Ok(stdout) => {
            let path_str = String::from_utf8(stdout)
                .map_err(|e| format!("Invalid UTF-8 in git rev-parse output: {}", e))?;
            let clean_str = path_str.trim();
            if clean_str.is_empty() {
                return Err("No git repository root found".into());
            }
            let p = PathBuf::from(clean_str);
            Ok(dunce::canonicalize(&p).unwrap_or(p))
        }
        Err(e) => {
            let mut curr = Some(actual_dir);
            while let Some(dir) = curr {
                if dir.join(".git").exists() {
                    return Ok(dunce::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf()));
                }
                curr = dir.parent();
            }
            Err(e)
        }
    }
}

fn parse_status_code(code: u8) -> GitFileStatus {
    match code {
        b'M' => GitFileStatus::Modified,
        b'A' => GitFileStatus::Added,
        b'D' => GitFileStatus::Deleted,
        b'R' => GitFileStatus::Renamed,
        b'C' => GitFileStatus::Copied,
        b'T' => GitFileStatus::TypeChanged,
        b'?' => GitFileStatus::Untracked,
        b'!' => GitFileStatus::Ignored,
        b'U' => GitFileStatus::Conflicted,
        _ => GitFileStatus::Unmodified,
    }
}

fn extract_path_after_spaces(entry: &[u8], target_spaces: usize) -> Option<String> {
    let mut space_count = 0;
    for (idx, &b) in entry.iter().enumerate() {
        if b == b' ' {
            space_count += 1;
            if space_count == target_spaces {
                let path_bytes = &entry[idx + 1..];
                if !path_bytes.is_empty() {
                    let s = String::from_utf8_lossy(path_bytes);
                    let normalized = s.trim_end_matches(['\r', '\n']).replace('\\', "/");
                    if !normalized.is_empty() {
                        return Some(normalized);
                    }
                }
                return None;
            }
        }
    }
    None
}

/// Parses raw porcelain v2 status bytes into a structured GitRepoStatus.
pub fn parse_porcelain_v2(stdout: &[u8], repo_root: &str) -> GitRepoStatus {
    let mut branch: Option<String> = None;
    let mut upstream: Option<String> = None;
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut is_detached = false;
    let mut files = Vec::new();
    let mut conflict_count = 0usize;

    let entries = stdout.split(|&b| b == 0);
    let mut iter = entries.peekable();

    while let Some(entry) = iter.next() {
        if entry.is_empty() {
            continue;
        }
        if entry.starts_with(b"# branch.head ") {
            let h = String::from_utf8_lossy(&entry[14..]).trim().to_string();
            if h == "(detached)" {
                is_detached = true;
            } else if !h.is_empty() {
                branch = Some(h);
            }
        } else if entry.starts_with(b"# branch.upstream ") {
            let u = String::from_utf8_lossy(&entry[18..]).trim().to_string();
            if !u.is_empty() {
                upstream = Some(u);
            }
        } else if entry.starts_with(b"# branch.ab ") {
            let ab = String::from_utf8_lossy(&entry[12..]);
            for part in ab.split_whitespace() {
                if let Some(rest) = part.strip_prefix('+') {
                    ahead = rest.parse().unwrap_or(0);
                } else if let Some(rest) = part.strip_prefix('-') {
                    behind = rest.parse().unwrap_or(0);
                }
            }
        } else if entry.starts_with(b"1 ") {
            if entry.len() > 3 {
                let staged = parse_status_code(entry[2]);
                let unstaged = parse_status_code(entry[3]);
                if let Some(path) = extract_path_after_spaces(entry, 8) {
                    files.push(GitFileChange {
                        path,
                        orig_path: None,
                        staged,
                        unstaged,
                        is_conflicted: false,
                    });
                }
            }
        } else if entry.starts_with(b"2 ") {
            if entry.len() > 3 {
                let staged = parse_status_code(entry[2]);
                let unstaged = parse_status_code(entry[3]);
                let path = extract_path_after_spaces(entry, 9).unwrap_or_default();
                let orig_path = iter.next().and_then(|p| {
                    if p.is_empty() {
                        None
                    } else {
                        let s = String::from_utf8_lossy(p);
                        let normalized = s.trim_end_matches(['\r', '\n']).replace('\\', "/");
                        if normalized.is_empty() {
                            None
                        } else {
                            Some(normalized)
                        }
                    }
                });
                files.push(GitFileChange {
                    path,
                    orig_path,
                    staged,
                    unstaged,
                    is_conflicted: false,
                });
            }
        } else if entry.starts_with(b"u ") {
            conflict_count += 1;
            if let Some(path) = extract_path_after_spaces(entry, 10) {
                files.push(GitFileChange {
                    path,
                    orig_path: None,
                    staged: GitFileStatus::Conflicted,
                    unstaged: GitFileStatus::Conflicted,
                    is_conflicted: true,
                });
            }
        } else if entry.starts_with(b"? ") {
            if let Some(path) = extract_path_after_spaces(entry, 1) {
                files.push(GitFileChange {
                    path,
                    orig_path: None,
                    staged: GitFileStatus::Unmodified,
                    unstaged: GitFileStatus::Untracked,
                    is_conflicted: false,
                });
            }
        }
    }

    GitRepoStatus {
        repo_root: repo_root.to_string(),
        branch,
        upstream,
        ahead,
        behind,
        is_detached,
        files,
        conflict_count,
    }
}

/// Queries repository status using high-performance machine-readable porcelain v2.
pub fn get_repo_status(repo_root: &Path) -> Result<GitRepoStatus, String> {
    let stdout = run_git_cmd(repo_root, &["status", "--porcelain=v2", "-z", "-b"])?;
    let root_str = repo_root.to_string_lossy().to_string();
    Ok(parse_porcelain_v2(&stdout, &root_str))
}
