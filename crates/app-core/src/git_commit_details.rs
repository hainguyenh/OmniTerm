//! Commit inspection operations for Git.
//!
//! Provides detailed file changes, additions, deletions, and commit message
//! for a specific commit point.

use crate::git::run_git_cmd;
use app_protocol::git::{GitCommitDetails, GitCommitFileChange, GitCommitSummary, GitFileStatus};
use std::collections::HashMap;
use std::path::Path;

fn parse_commit_header_and_message(text: &str) -> Option<(GitCommitSummary, String)> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    let fields: Vec<&str> = trimmed.split('\x1f').collect();
    if fields.len() < 8 {
        return None;
    }
    let parents: Vec<String> = fields[6]
        .split_whitespace()
        .map(|p| p.to_string())
        .collect();
    let summary = GitCommitSummary {
        id: fields[0].to_string(),
        short_id: fields[1].to_string(),
        summary: fields[2].to_string(),
        author_name: fields[3].to_string(),
        author_email: fields[4].to_string(),
        timestamp: fields[5].parse().unwrap_or(0),
        parents,
    };
    let full_message = fields[7].trim().to_string();
    Some((summary, full_message))
}

fn parse_numstat(text: &str) -> HashMap<String, (u32, u32, bool)> {
    let mut map = HashMap::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let is_binary = parts[0] == "-" || parts[1] == "-";
        let additions = if is_binary {
            0
        } else {
            parts[0].parse().unwrap_or(0)
        };
        let deletions = if is_binary {
            0
        } else {
            parts[1].parse().unwrap_or(0)
        };
        let path = parts[2].to_string();
        map.insert(path, (additions, deletions, is_binary));
    }
    map
}

fn parse_name_status(
    text: &str,
    mut numstats: HashMap<String, (u32, u32, bool)>,
) -> (Vec<GitCommitFileChange>, u32, u32) {
    let mut files = Vec::new();
    let mut total_additions = 0u32;
    let mut total_deletions = 0u32;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split('\t').collect();
        let status_code = parts.first().copied().unwrap_or("");
        let (status, old_path, path) =
            if (status_code.starts_with('R') || status_code.starts_with('C')) && parts.len() >= 3 {
                let st = if status_code.starts_with('R') {
                    GitFileStatus::Renamed
                } else {
                    GitFileStatus::Copied
                };
                (st, Some(parts[1].to_string()), parts[2].to_string())
            } else if parts.len() >= 2 {
                let st = match status_code.chars().next() {
                    Some('A') => GitFileStatus::Added,
                    Some('D') => GitFileStatus::Deleted,
                    Some('M') => GitFileStatus::Modified,
                    Some('T') => GitFileStatus::TypeChanged,
                    _ => GitFileStatus::Modified,
                };
                (st, None, parts[1].to_string())
            } else {
                continue;
            };

        let (additions, deletions, is_binary) = numstats
            .remove(&path)
            .or_else(|| old_path.as_ref().and_then(|old| numstats.remove(old)))
            .unwrap_or((0, 0, false));

        total_additions += additions;
        total_deletions += deletions;

        files.push(GitCommitFileChange {
            path,
            old_path,
            status,
            additions,
            deletions,
            is_binary,
        });
    }

    for (path, (additions, deletions, is_binary)) in numstats {
        total_additions += additions;
        total_deletions += deletions;
        files.push(GitCommitFileChange {
            path,
            old_path: None,
            status: GitFileStatus::Modified,
            additions,
            deletions,
            is_binary,
        });
    }

    (files, total_additions, total_deletions)
}

/// Retrieves comprehensive details for a commit point, including changed files and stats.
pub fn get_commit_details(repo_root: &Path, commit_id: &str) -> Result<GitCommitDetails, String> {
    let commit_ref = commit_id.trim();
    if commit_ref.is_empty() || commit_ref.starts_with('-') {
        return Err("Invalid commit reference".into());
    }

    let format_arg = "--format=%H\x1f%h\x1f%s\x1f%an\x1f%ae\x1f%at\x1f%P\x1f%B";
    let header_out = run_git_cmd(repo_root, &["log", "-1", format_arg, commit_ref])?;
    let (commit, full_message) =
        parse_commit_header_and_message(&String::from_utf8_lossy(&header_out))
            .ok_or_else(|| format!("Commit not found: {commit_ref}"))?;

    let numstat_out = run_git_cmd(
        repo_root,
        &[
            "diff-tree",
            "--no-commit-id",
            "--numstat",
            "-r",
            "-m",
            "--root",
            commit_ref,
        ],
    )
    .map(|o| String::from_utf8_lossy(&o).into_owned())
    .unwrap_or_default();
    let numstat_map = parse_numstat(&numstat_out);

    let status_out = run_git_cmd(
        repo_root,
        &[
            "diff-tree",
            "--no-commit-id",
            "--name-status",
            "-r",
            "-m",
            "--root",
            "-M",
            commit_ref,
        ],
    )?;
    let (files, total_additions, total_deletions) =
        parse_name_status(&String::from_utf8_lossy(&status_out), numstat_map);
    let total_files = files.len();

    Ok(GitCommitDetails {
        commit,
        full_message,
        files,
        total_additions,
        total_deletions,
        total_files,
    })
}

fn normalize_path(repo_root: &Path, file_path: &str) -> String {
    let clean = file_path.replace('\\', "/");
    let p = Path::new(&clean);
    if let Ok(stripped) = p.strip_prefix(repo_root) {
        stripped.to_string_lossy().replace('\\', "/")
    } else {
        clean
            .trim_start_matches("./")
            .trim_start_matches('/')
            .to_string()
    }
}

/// Retrieves the diff for a specific file in a commit point.
pub fn get_commit_file_diff(
    repo_root: &Path,
    commit_id: &str,
    file_path: &str,
    old_path: Option<&str>,
) -> Result<app_protocol::git::GitFileDiff, String> {
    let commit_ref = commit_id.trim();
    if commit_ref.is_empty() || commit_ref.starts_with('-') {
        return Err("Invalid commit reference".into());
    }
    let normalized_path = normalize_path(repo_root, file_path);
    let normalized_old = old_path.map(|p| normalize_path(repo_root, p));

    let mut args = vec![
        "diff-tree",
        "--no-commit-id",
        "--no-color",
        "--no-ext-diff",
        "-p",
        "-m",
        "--first-parent",
        "--root",
        "-r",
        "-M",
        commit_ref,
        "--",
        &normalized_path,
    ];
    if let Some(ref old) = normalized_old {
        if old != &normalized_path {
            args.push(old);
        }
    }

    let raw = run_git_cmd(repo_root, &args)?;
    let clean_str = crate::git_diff::strip_ansi_codes(&String::from_utf8_lossy(&raw));
    let mut diff = crate::git_diff::parse_unified_diff(&normalized_path, &clean_str);

    if diff.hunks.is_empty() && !diff.is_binary {
        let mut alt_args = vec![
            "diff-tree",
            "--no-commit-id",
            "--no-color",
            "--no-ext-diff",
            "-p",
            "-m",
            "--root",
            "-r",
            "-M",
            commit_ref,
            "--",
            &normalized_path,
        ];
        if let Some(ref old) = normalized_old {
            if old != &normalized_path {
                alt_args.push(old);
            }
        }
        if let Ok(alt_raw) = run_git_cmd(repo_root, &alt_args) {
            let alt_str = crate::git_diff::strip_ansi_codes(&String::from_utf8_lossy(&alt_raw));
            let alt_diff = crate::git_diff::parse_unified_diff(&normalized_path, &alt_str);
            if !alt_diff.hunks.is_empty() {
                diff = alt_diff;
            }
        }
    }

    Ok(diff)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_test_repo::TestRepo;

    #[test]
    fn test_parse_numstat_and_name_status() {
        let numstat_text = "5\t2\tsrc/app.rs\n10\t0\tREADME.md\n-\t-\timage.png\n";
        let map = parse_numstat(numstat_text);
        assert_eq!(map.get("src/app.rs"), Some(&(5, 2, false)));
        assert_eq!(map.get("README.md"), Some(&(10, 0, false)));
        assert_eq!(map.get("image.png"), Some(&(0, 0, true)));

        let status_text = "M\tsrc/app.rs\nA\tREADME.md\nA\timage.png\n";
        let (files, adds, dels) = parse_name_status(status_text, map);
        assert_eq!(files.len(), 3);
        assert_eq!(adds, 15);
        assert_eq!(dels, 2);
        assert_eq!(files[0].status, GitFileStatus::Modified);
        assert_eq!(files[1].status, GitFileStatus::Added);
        assert_eq!(files[2].status, GitFileStatus::Added);
        assert!(files[2].is_binary);
    }

    #[test]
    fn test_get_commit_details_in_repo() {
        let repo = TestRepo::new();
        let head = repo.head();
        let details = get_commit_details(&repo.root, &head).expect("details");
        assert_eq!(details.commit.id, head);
        assert_eq!(details.commit.summary, "initial");
        assert_eq!(details.total_files, 1);
        assert_eq!(details.files[0].path, "a.txt");
        assert_eq!(details.files[0].status, GitFileStatus::Added);

        let commit2 = repo.commit_file(
            "b.txt",
            "line1\nline2\n",
            "feat: second file\n\nBody details.",
        );
        let details2 = get_commit_details(&repo.root, &commit2).expect("details 2");
        assert_eq!(details2.commit.summary, "feat: second file");
        assert!(details2.full_message.contains("Body details."));
        assert_eq!(details2.total_files, 1);
        assert_eq!(details2.files[0].path, "b.txt");
        assert_eq!(details2.files[0].additions, 2);
    }

    #[test]
    fn test_invalid_commit_ref() {
        let repo = TestRepo::new();
        assert!(get_commit_details(&repo.root, "--bad-flag").is_err());
        assert!(get_commit_details(&repo.root, "").is_err());
        assert!(get_commit_file_diff(&repo.root, "--bad-flag", "a.txt", None).is_err());
        assert!(get_commit_file_diff(&repo.root, "", "a.txt", None).is_err());
    }

    #[test]
    fn test_get_commit_file_diff() {
        let repo = TestRepo::new();
        let head = repo.head();
        let diff = get_commit_file_diff(&repo.root, &head, "a.txt", None).expect("commit file diff");
        assert_eq!(diff.path, "a.txt");
        assert!(!diff.is_binary);
        assert!(!diff.hunks.is_empty());
        assert!(diff.hunks[0].lines.iter().any(|l| l.content == "one"));

        let diff_with_old = get_commit_file_diff(&repo.root, &head, "a.txt", Some("a.txt")).expect("diff with old");
        assert_eq!(diff_with_old.path, "a.txt");

        let p1 = normalize_path(&repo.root, &repo.root.join("a.txt").to_string_lossy());
        assert_eq!(p1, "a.txt");
        let p2 = normalize_path(&repo.root, "./dir/file.txt");
        assert_eq!(p2, "dir/file.txt");

        assert!(parse_commit_header_and_message("").is_none());
        assert!(parse_commit_header_and_message("a\x1fb").is_none());

        let (files, adds, dels) = parse_name_status(
            "R100\told.txt\tnew.txt\nC100\tsrc.txt\tdst.txt\nD\tdel.txt\nT\ttype.txt\ninvalid\n",
            HashMap::new(),
        );
        assert_eq!(files.len(), 4);
        assert_eq!(adds, 0);
        assert_eq!(dels, 0);
        assert_eq!(files[0].status, GitFileStatus::Renamed);
        assert_eq!(files[1].status, GitFileStatus::Copied);
        assert_eq!(files[2].status, GitFileStatus::Deleted);
        assert_eq!(files[3].status, GitFileStatus::TypeChanged);

        assert!(get_commit_details(&repo.root, "0000000000000000000000000000000000000000").is_err());
    }
}

