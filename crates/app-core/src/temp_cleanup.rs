//! Quick clean-up of the temp folder that AI agents and build tools fill up.
//!
//! Explorer is slow here because it counts every file before deleting. This works on the
//! folder's direct children only: [`scan`] sizes them and groups the ones of one kind (`claude-1a2b`
//! and `claude-9z8y` are one group), and [`clean`] removes the chosen groups' entries that have not
//! changed for a while. An entry that cannot be removed (locked, no permission) is skipped and
//! reported, never retried in a loop. Links are removed, not followed.

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Entries a skipped list keeps; the rest are only counted.
const MAX_SKIPPED_LISTED: usize = 50;

/// Entries of one kind: the same name once ids, hashes and numbers are masked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TempGroup {
    pub key: String,
    /// Direct children of the temp folder in this group.
    pub entries: u64,
    /// Files inside them (a plain file counts as one).
    pub files: u64,
    pub bytes: u64,
    /// Seconds since the epoch of the least and most recently changed entry.
    pub oldest: u64,
    pub newest: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedEntry {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanReport {
    pub removed: u64,
    pub freed_bytes: u64,
    /// Entries left because they are too new, or were not removable.
    pub kept: u64,
    pub skipped: Vec<SkippedEntry>,
}

/// The kind of entry `name` is: runs of digits and of 6+ hex/`-`/`_` characters become `*`.
pub fn group_key(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    let chars: Vec<char> = lower.chars().collect();
    let mut key = String::new();
    let mut i = 0;
    while i < chars.len() {
        // An id starts at a digit, or at a hex letter that begins a word, so the `-` or `_` before
        // it and the letters of a name like `claude` stay in the key.
        let starts_id = chars[i].is_ascii_digit()
            || (chars[i].is_ascii_hexdigit() && (i == 0 || !chars[i - 1].is_ascii_alphanumeric()));
        let mut j = i;
        while starts_id
            && j < chars.len()
            && (chars[j].is_ascii_hexdigit() || chars[j] == '-' || chars[j] == '_')
        {
            j += 1;
        }
        let run = &chars[i..j];
        let has_digit = run.iter().any(char::is_ascii_digit);
        if j > i && (run.len() >= 6 || chars[i].is_ascii_digit()) && has_digit {
            if !key.ends_with('*') {
                key.push('*');
            }
            i = j;
        } else {
            key.push(chars[i]);
            i += 1;
        }
    }
    if key.is_empty() || key == "*" {
        "(other)".to_string()
    } else {
        key
    }
}

fn secs(time: SystemTime) -> u64 {
    time.duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Files and bytes under `path`, links not followed; unreadable parts count as nothing.
fn measure(path: &Path) -> (u64, u64) {
    let (mut files, mut bytes) = (0, 0);
    let mut stack = vec![path.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(meta) = fs::symlink_metadata(&current) else {
            continue;
        };
        if meta.is_dir() {
            if let Ok(children) = fs::read_dir(&current) {
                stack.extend(children.flatten().map(|child| child.path()));
            }
        } else {
            files += 1;
            bytes += meta.len();
        }
    }
    (files, bytes)
}

fn modified(path: &Path) -> Option<SystemTime> {
    fs::symlink_metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
}

/// A usable temp folder: an existing directory that is not a drive root or a top-level folder.
fn checked_root(root: &Path) -> Result<(), String> {
    if !root.is_dir() {
        return Err(format!("{} is not a folder.", root.display()));
    }
    if root.components().count() < 3 {
        return Err(format!(
            "{} is too close to the drive root to clean.",
            root.display()
        ));
    }
    Ok(())
}

/// Groups the direct children of `root`, the biggest group first.
pub fn scan(root: &Path) -> Result<Vec<TempGroup>, String> {
    checked_root(root)?;
    let mut groups: BTreeMap<String, TempGroup> = BTreeMap::new();
    let children =
        fs::read_dir(root).map_err(|error| format!("Cannot read {}: {error}", root.display()))?;
    for child in children.flatten() {
        let path = child.path();
        let (files, bytes) = measure(&path);
        let changed = modified(&path).map_or(0, secs);
        let key = group_key(&child.file_name().to_string_lossy());
        let group = groups.entry(key.clone()).or_insert(TempGroup {
            key,
            entries: 0,
            files: 0,
            bytes: 0,
            oldest: u64::MAX,
            newest: 0,
        });
        group.entries += 1;
        group.files += files;
        group.bytes += bytes;
        group.oldest = group.oldest.min(changed);
        group.newest = group.newest.max(changed);
    }
    let mut list: Vec<TempGroup> = groups.into_values().collect();
    list.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.key.cmp(&b.key)));
    Ok(list)
}

fn remove_once(path: &Path, is_dir: bool) -> io::Result<()> {
    if is_dir {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

/// Removes `path` whatever it is; a read-only entry is made writable and removed once more.
fn remove_entry(path: &Path) -> io::Result<()> {
    let is_dir = fs::symlink_metadata(path)?.is_dir();
    match remove_once(path, is_dir) {
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            clear_read_only(path);
            remove_once(path, is_dir)
        }
        other => other,
    }
}

fn clear_read_only(path: &Path) {
    let mut stack = vec![path.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(meta) = fs::symlink_metadata(&current) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        let mut permissions = meta.permissions();
        if permissions.readonly() {
            // The Windows read-only attribute; the entry is deleted right after.
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
            let _ = fs::set_permissions(&current, permissions);
        }
        if meta.is_dir() {
            if let Ok(children) = fs::read_dir(&current) {
                stack.extend(children.flatten().map(|child| child.path()));
            }
        }
    }
}

/// Removes the direct children of `root` that belong to one of `keys` (every group for `None`) and
/// have not changed for `older_than`. What cannot be removed is skipped and listed in the report.
pub fn clean(
    root: &Path,
    keys: Option<&[String]>,
    older_than: Duration,
    now: SystemTime,
) -> Result<CleanReport, String> {
    checked_root(root)?;
    let cutoff = now
        .checked_sub(older_than)
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let mut report = CleanReport::default();
    let children =
        fs::read_dir(root).map_err(|error| format!("Cannot read {}: {error}", root.display()))?;
    let entries: Vec<PathBuf> = children.flatten().map(|child| child.path()).collect();
    for path in entries {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if keys.is_some_and(|keys| !keys.contains(&group_key(&name))) {
            continue;
        }
        if modified(&path).is_some_and(|changed| changed > cutoff) {
            report.kept += 1;
            continue;
        }
        let (_, bytes) = measure(&path);
        match remove_entry(&path) {
            Ok(()) => {
                report.removed += 1;
                report.freed_bytes += bytes;
            }
            // Gone already (another process cleaned it): nothing to report.
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                report.kept += 1;
                if report.skipped.len() < MAX_SKIPPED_LISTED {
                    report.skipped.push(SkippedEntry {
                        name,
                        reason: error.to_string(),
                    });
                }
            }
        }
    }
    Ok(report)
}

#[cfg(test)]
#[path = "temp_cleanup_tests.rs"]
mod tests;
