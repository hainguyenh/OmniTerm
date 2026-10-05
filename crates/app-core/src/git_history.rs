//! Per-file Git history for the editor: where a file sits in its repository, and which commits
//! touched the whole file (following renames) or a line range of it (`git log -L`).

use std::path::Path;

use app_protocol::git::{GitCommitSummary, GitFileContext, GitFileHistoryEntry};

use crate::git::run_git_cmd;

#[cfg(test)]
#[path = "git_history_tests.rs"]
mod tests;

/// Default and maximum number of commits one history request returns.
pub const DEFAULT_HISTORY_LIMIT: usize = 200;
const MAX_HISTORY_LIMIT: usize = 1000;

/// Commit header fields, each record opened by RS so patch or name output after it can be skipped.
const HISTORY_FORMAT: &str = "--format=%x1e%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%at%x1f%P";

/// Locate `file` in its repository: the root, the git-style relative path and the current branch.
///
/// Asks git rather than stripping prefixes, so a workspace folder reached through a symlink or a
/// differently-cased drive letter still maps to the path git uses.
pub fn file_context(file: &Path) -> Result<GitFileContext, String> {
    let name = file
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| format!("not a file: {}", file.display()))?;
    let dir = file
        .parent()
        .ok_or_else(|| format!("not a file: {}", file.display()))?;
    let stdout = run_git_cmd(dir, &["rev-parse", "--show-toplevel", "--show-prefix"])?;
    let text = String::from_utf8_lossy(&stdout);
    let mut lines = text.lines();
    let top = lines
        .next()
        .map(str::trim)
        .filter(|top| !top.is_empty())
        .ok_or_else(|| "No git repository root found".to_string())?;
    let prefix = lines.next().map(str::trim).unwrap_or_default();
    let repo_root = dunce::canonicalize(top)
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| top.to_string());
    let branch = run_git_cmd(dir, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok()
        .map(|out| String::from_utf8_lossy(&out).trim().to_string())
        .filter(|branch| !branch.is_empty());
    Ok(GitFileContext {
        repo_root,
        relative_path: format!("{prefix}{name}"),
        branch,
    })
}

/// Commits that touched `file_path`, newest first.
///
/// `lines` (1-based, inclusive) narrows the history to commits that changed that range, as git
/// traces it backwards from `HEAD`; without it the whole file's history is listed across renames.
pub fn get_file_history(
    repo_root: &Path,
    file_path: &str,
    lines: Option<(u32, u32)>,
    limit: usize,
) -> Result<Vec<GitFileHistoryEntry>, String> {
    let path = file_path.replace('\\', "/");
    if path.is_empty() || path.starts_with('/') || path.split('/').any(|part| part == "..") {
        return Err("Invalid path traversal".into());
    }
    let limit = limit.clamp(1, MAX_HISTORY_LIMIT).to_string();
    // Unquoted paths and no signature output: both would otherwise be read as a file name below.
    let mut args = vec![
        "-c",
        "core.quotePath=false",
        "log",
        "--no-show-signature",
        "-n",
        limit.as_str(),
        HISTORY_FORMAT,
    ];
    let range_arg;
    match lines {
        Some((start, end)) => {
            if start == 0 || end < start {
                return Err(format!("Invalid line range {start}-{end}"));
            }
            range_arg = format!("-L{start},{end}:{path}");
            // Pinned prefixes, whatever `diff.noprefix` / `diff.mnemonicPrefix` say.
            args.extend(["--src-prefix=a/", "--dst-prefix=b/", range_arg.as_str()]);
        }
        None => args.extend(["--follow", "--name-only", "--", path.as_str()]),
    }
    let stdout = run_git_cmd(repo_root, &args)?;
    Ok(parse_file_history(&String::from_utf8_lossy(&stdout), &path))
}

/// Parse `HISTORY_FORMAT` records, each followed by either `--name-only` output or an `-L` patch.
///
/// The path at each commit comes from the patch's `+++ b/` line or the name list; when neither is
/// present (a merge lists no names) the newer commit's path carries over.
pub(crate) fn parse_file_history(text: &str, current_path: &str) -> Vec<GitFileHistoryEntry> {
    let mut entries = Vec::new();
    let mut carried = current_path.to_string();
    for record in text.split('\x1e') {
        let mut lines = record.lines();
        let Some(commit) = lines.next().and_then(parse_commit_header) else {
            continue;
        };
        let named = lines.map(str::trim).find_map(|line| {
            if let Some(path) = line.strip_prefix("+++ b/") {
                Some(path)
            } else if line.is_empty()
                || line.starts_with("diff --git ")
                || line.starts_with("--- ")
                || line.starts_with("+++ ")
                || line.starts_with("index ")
                || line.starts_with("new file mode")
                || line.starts_with("deleted file mode")
                || line.starts_with("similarity index")
                || line.starts_with("rename ")
            {
                None
            } else if record.contains("\ndiff --git ") {
                // Inside an `-L` patch only `+++ b/` names the file; hunk lines never do.
                None
            } else {
                Some(line)
            }
        });
        if let Some(path) = named {
            carried = path.to_string();
        }
        entries.push(GitFileHistoryEntry {
            commit,
            path: carried.clone(),
        });
    }
    entries
}

fn parse_commit_header(line: &str) -> Option<GitCommitSummary> {
    let fields: Vec<&str> = line.split('\x1f').collect();
    if fields.len() < 7 || fields[0].is_empty() {
        return None;
    }
    Some(GitCommitSummary {
        id: fields[0].to_string(),
        short_id: fields[1].to_string(),
        summary: fields[2].to_string(),
        author_name: fields[3].to_string(),
        author_email: fields[4].to_string(),
        timestamp: fields[5].parse().unwrap_or(0),
        parents: fields[6].split_whitespace().map(str::to_string).collect(),
    })
}
