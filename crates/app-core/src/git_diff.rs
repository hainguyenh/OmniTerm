//! Unified diff parsing and file diff retrieval for Git.

use app_protocol::git::{GitDiffHunk, GitDiffLine, GitDiffLineType, GitFileDiff};
use std::path::Path;

/// Parses unified diff text into structured hunks and lines.
pub fn parse_unified_diff(file_path: &str, diff_text: &str) -> GitFileDiff {
    let mut hunks = Vec::new();
    let mut current_hunk: Option<GitDiffHunk> = None;
    let mut old_line_counter = 0u32;
    let mut new_line_counter = 0u32;
    let mut is_binary = false;

    for line in diff_text.lines() {
        if line.starts_with("Binary files ") && line.ends_with(" differ") {
            is_binary = true;
            break;
        }
        if line.starts_with("@@") {
            if let Some(h) = current_hunk.take() {
                hunks.push(h);
            }
            let (old_start, old_lines, new_start, new_lines) = parse_hunk_header(line);
            old_line_counter = old_start;
            new_line_counter = new_start;
            current_hunk = Some(GitDiffHunk {
                old_start,
                old_lines,
                new_start,
                new_lines,
                header: line.to_string(),
                lines: Vec::new(),
            });
            continue;
        }

        if let Some(hunk) = &mut current_hunk {
            if let Some(stripped) = line.strip_prefix('+') {
                hunk.lines.push(GitDiffLine {
                    line_type: GitDiffLineType::Addition,
                    old_lineno: None,
                    new_lineno: Some(new_line_counter),
                    content: stripped.to_string(),
                });
                new_line_counter += 1;
            } else if let Some(stripped) = line.strip_prefix('-') {
                hunk.lines.push(GitDiffLine {
                    line_type: GitDiffLineType::Deletion,
                    old_lineno: Some(old_line_counter),
                    new_lineno: None,
                    content: stripped.to_string(),
                });
                old_line_counter += 1;
            } else if let Some(stripped) = line.strip_prefix(' ') {
                hunk.lines.push(GitDiffLine {
                    line_type: GitDiffLineType::Context,
                    old_lineno: Some(old_line_counter),
                    new_lineno: Some(new_line_counter),
                    content: stripped.to_string(),
                });
                old_line_counter += 1;
                new_line_counter += 1;
            }
        }
    }

    if let Some(h) = current_hunk {
        hunks.push(h);
    }

    GitFileDiff {
        path: file_path.to_string(),
        is_binary,
        hunks,
    }
}

fn parse_hunk_header(header: &str) -> (u32, u32, u32, u32) {
    let parts: Vec<&str> = header.split("@@").collect();
    if parts.len() < 3 {
        return (1, 0, 1, 0);
    }
    let inner = parts[1].trim();
    let mut old_start = 1;
    let mut old_lines = 1;
    let mut new_start = 1;
    let mut new_lines = 1;

    for segment in inner.split_whitespace() {
        if let Some(old_part) = segment.strip_prefix('-') {
            let sub: Vec<&str> = old_part.split(',').collect();
            old_start = sub[0].parse().unwrap_or(1);
            old_lines = if sub.len() > 1 {
                sub[1].parse().unwrap_or(1)
            } else {
                1
            };
        } else if let Some(new_part) = segment.strip_prefix('+') {
            let sub: Vec<&str> = new_part.split(',').collect();
            new_start = sub[0].parse().unwrap_or(1);
            new_lines = if sub.len() > 1 {
                sub[1].parse().unwrap_or(1)
            } else {
                1
            };
        }
    }
    (old_start, old_lines, new_start, new_lines)
}

use crate::git::create_git_cmd;

/// Strips ANSI escape codes from git command output if present.
pub fn strip_ansi_codes(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut in_escape = false;
    for c in input.chars() {
        if c == '\x1b' {
            in_escape = true;
        } else if in_escape {
            if c == 'm' || c.is_ascii_alphabetic() {
                in_escape = false;
            }
        } else {
            result.push(c);
        }
    }
    result
}

/// Executes a git diff command allowing exit code 0 and 1 (1 indicates differences found).
fn run_git_diff_cmd(cwd: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
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
        .map_err(|e| format!("Failed to execute git diff: {}", e))?;

    let code = output.status.code().unwrap_or(0);
    if code > 1 {
        let err_msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err_msg.is_empty() {
            format!("git diff failed with exit code {}", code)
        } else {
            err_msg
        });
    }

    Ok(output.stdout)
}

fn normalize_repo_relative_path(repo_root: &Path, file_path: &str) -> String {
    let p = Path::new(file_path);
    if let Ok(stripped) = p.strip_prefix(repo_root) {
        stripped.to_string_lossy().replace('\\', "/")
    } else {
        file_path
            .trim_start_matches("./")
            .trim_start_matches('/')
            .replace('\\', "/")
    }
}

fn is_file_untracked(cwd: &Path, rel_path: &str) -> bool {
    let output = create_git_cmd(cwd, &["ls-files", "--error-unmatch", "--", rel_path]).output();
    match output {
        Ok(out) => !out.status.success(),
        Err(_) => false,
    }
}

/// Retrieves the structured diff for a given file in the repository.
pub fn get_file_diff(
    repo_root: &Path,
    file_path: &str,
    staged: bool,
) -> Result<GitFileDiff, String> {
    let normalized_path = normalize_repo_relative_path(repo_root, file_path);
    let args: Vec<&str> = if staged {
        vec![
            "diff",
            "--no-ext-diff",
            "--no-color",
            "-M",
            "--cached",
            "--unified=3",
            "--",
            &normalized_path,
        ]
    } else {
        vec![
            "diff",
            "--no-ext-diff",
            "--no-color",
            "-M",
            "--unified=3",
            "--",
            &normalized_path,
        ]
    };

    let raw = run_git_diff_cmd(repo_root, &args)?;
    let clean_str = strip_ansi_codes(&String::from_utf8_lossy(&raw));

    if clean_str.trim().is_empty() && !staged {
        let full_path = repo_root.join(&normalized_path);
        if full_path.exists() && full_path.is_file() && is_file_untracked(repo_root, &normalized_path) {
            let untracked_diff = run_git_diff_cmd(
                repo_root,
                &[
                    "diff",
                    "--no-ext-diff",
                    "--no-color",
                    "--no-index",
                    "--unified=3",
                    "--",
                    "/dev/null",
                    &normalized_path,
                ],
            );
            if let Ok(raw_u) = untracked_diff {
                let u_str = strip_ansi_codes(&String::from_utf8_lossy(&raw_u));
                if !u_str.trim().is_empty() {
                    return Ok(parse_unified_diff(&normalized_path, &u_str));
                }
            }

            if let Ok(bytes) = std::fs::read(&full_path) {
                if bytes.contains(&0) {
                    return Ok(GitFileDiff {
                        path: normalized_path,
                        is_binary: true,
                        hunks: Vec::new(),
                    });
                }
                if let Ok(content) = String::from_utf8(bytes) {
                    let lines: Vec<GitDiffLine> = content
                        .lines()
                        .enumerate()
                        .map(|(idx, l)| GitDiffLine {
                            line_type: GitDiffLineType::Addition,
                            old_lineno: None,
                            new_lineno: Some((idx + 1) as u32),
                            content: l.to_string(),
                        })
                        .collect();

                    let line_count = lines.len() as u32;
                    return Ok(GitFileDiff {
                        path: normalized_path,
                        is_binary: false,
                        hunks: vec![GitDiffHunk {
                            old_start: 0,
                            old_lines: 0,
                            new_start: 1,
                            new_lines: line_count,
                            header: format!("@@ -0,0 +1,{} @@", line_count),
                            lines,
                        }],
                    });
                }
            }
        }
    }

    Ok(parse_unified_diff(&normalized_path, &clean_str))
}

/// Retrieves the diff for a file compared against a target branch/revision.
pub fn get_file_diff_against_ref(
    repo_root: &Path,
    file_path: &str,
    target_ref: &str,
) -> Result<GitFileDiff, String> {
    let normalized_path = normalize_repo_relative_path(repo_root, file_path);
    let args = [
        "diff",
        "--no-ext-diff",
        "--no-color",
        "-M",
        "--unified=3",
        target_ref,
        "--",
        &normalized_path,
    ];
    let raw = run_git_diff_cmd(repo_root, &args)?;
    let clean_str = strip_ansi_codes(&String::from_utf8_lossy(&raw));
    Ok(parse_unified_diff(&normalized_path, &clean_str))
}
