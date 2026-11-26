//! Quick clean-up of the temp folder that AI agents and build tools fill up.
//!
//! Explorer is slow here because it counts every file before deleting. This works on the
//! folder's direct children only: [`scan`] sizes them and groups the ones of one kind (`claude-1a2b`
//! and `claude-9z8y` are one group), and [`clean`] removes the chosen groups' entries that have not
//! changed for a while. Both spread the children over a few threads and report progress
//! ([`scan_with`], [`clean_with`]); sizes come from the directory listings, and a removal counts
//! what it frees as it goes instead of sizing the entry first. An entry that cannot be removed
//! (locked, no permission) is skipped and reported, never retried in a loop. Links are removed,
//! not followed.

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, SystemTime};

use crate::parallel::{par_map, Tally};

#[path = "temp_cleanup_walk.rs"]
mod walk;

pub use crate::parallel::{Progress, Step};
pub(crate) use walk::{measure, remove_tree};

/// Entries a skipped list keeps; the rest are only counted.
const MAX_SKIPPED_LISTED: usize = 50;

/// The idle times the Clean Temp Files dialog offers, in days. A scan says how much of each group
/// every one of them would delete, so the dialog never offers a clean-up that removes nothing.
pub const IDLE_DAYS: [u32; 4] = [1, 3, 7, 30];

/// The entries of a group unchanged for at least `days` days: what a clean-up with that idle
/// time removes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleShare {
    pub days: u32,
    pub entries: u64,
    pub bytes: u64,
}

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
    /// One share per [`IDLE_DAYS`], in that order.
    pub idle: Vec<IdleShare>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedEntry {
    pub name: String,
    pub reason: String,
}

/// What a clean-up did to one group: the renderer updates its list from this instead of scanning
/// the whole temp folder again.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupResult {
    pub key: String,
    pub removed: u64,
    pub freed_bytes: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanReport {
    pub removed: u64,
    pub freed_bytes: u64,
    /// Entries left because they are too new, were not removable, or the clean-up was cancelled.
    pub kept: u64,
    pub skipped: Vec<SkippedEntry>,
    pub groups: Vec<GroupResult>,
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

/// The group of one child of the temp folder: folders by their masked name (`bizreq-*`), loose
/// files by extension (`*.log`) so the many single files an agent or tool leaves are one kind.
pub fn entry_key(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    key_of(
        &name,
        fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir()),
    )
}

fn key_of(name: &str, is_dir: bool) -> String {
    if is_dir {
        return group_key(name);
    }
    match Path::new(name).extension().and_then(|e| e.to_str()) {
        Some(ext) if !ext.is_empty() && ext.len() <= 12 => {
            format!("*.{} files", ext.to_ascii_lowercase())
        }
        _ => "(files without extension)".to_string(),
    }
}

fn secs(time: SystemTime) -> u64 {
    time.duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
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

/// A direct child of the temp folder, as its directory listing describes it.
struct Child {
    path: PathBuf,
    name: String,
    key: String,
    is_dir: bool,
    len: u64,
    modified: Option<SystemTime>,
}

/// The direct children of `root`, from one listing: kind, size and age come with the entries.
fn children(root: &Path) -> Result<Vec<Child>, String> {
    let listing =
        fs::read_dir(root).map_err(|error| format!("Cannot read {}: {error}", root.display()))?;
    Ok(listing
        .flatten()
        .map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let meta = entry.metadata().ok();
            // A link is an entry of its own, never followed: it is grouped and sized as a file.
            let is_dir = entry.file_type().is_ok_and(|kind| kind.is_dir());
            Child {
                key: key_of(&name, is_dir),
                is_dir,
                len: meta.as_ref().map_or(0, fs::Metadata::len),
                modified: meta.and_then(|meta| meta.modified().ok()),
                path: entry.path(),
                name,
            }
        })
        .collect())
}

/// Groups the direct children of `root`, the biggest group first.
pub fn scan(root: &Path) -> Result<Vec<TempGroup>, String> {
    scan_with(root, &silent())
}

/// [`scan`] with progress after every child, sized on several threads. Cancelling returns the
/// groups of the children sized so far.
pub fn scan_with(root: &Path, progress: &Progress<'_>) -> Result<Vec<TempGroup>, String> {
    checked_root(root)?;
    let children = children(root)?;
    let total = children.len() as u64;
    let tally = Tally::default();
    let sized = par_map(children, |child| {
        if progress.cancelled() {
            return None;
        }
        let (files, bytes) = measure(&child.path, child.is_dir, child.len, progress);
        tally.finish(bytes, total, progress);
        Some((child, files, bytes))
    });
    let now = SystemTime::now();
    let mut groups: BTreeMap<String, TempGroup> = BTreeMap::new();
    for (child, files, bytes) in sized.into_iter().flatten() {
        let changed = child.modified.map_or(0, secs);
        // An entry without a modified time is removed by any clean-up (see `clean_with`).
        let idle_for = child.modified.map_or(Duration::MAX, |modified| {
            now.duration_since(modified).unwrap_or(Duration::ZERO)
        });
        let group = groups
            .entry(child.key.clone())
            .or_insert_with(|| TempGroup {
                key: child.key,
                entries: 0,
                files: 0,
                bytes: 0,
                oldest: u64::MAX,
                newest: 0,
                idle: IDLE_DAYS
                    .iter()
                    .map(|&days| IdleShare {
                        days,
                        ..IdleShare::default()
                    })
                    .collect(),
            });
        group.entries += 1;
        group.files += files;
        group.bytes += bytes;
        group.oldest = group.oldest.min(changed);
        group.newest = group.newest.max(changed);
        for share in &mut group.idle {
            if idle_for >= Duration::from_secs(u64::from(share.days) * 86_400) {
                share.entries += 1;
                share.bytes += bytes;
            }
        }
    }
    let mut list: Vec<TempGroup> = groups.into_values().collect();
    list.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.key.cmp(&b.key)));
    Ok(list)
}

/// Removes the direct children of `root` that belong to one of `keys` (every group for `None`) and
/// have not changed for `older_than`. What cannot be removed is skipped and listed in the report.
pub fn clean(
    root: &Path,
    keys: Option<&[String]>,
    older_than: Duration,
    now: SystemTime,
) -> Result<CleanReport, String> {
    clean_with(root, keys, older_than, now, &silent())
}

/// [`clean`] on several threads, each entry removed in one pass that counts what it frees, with
/// progress after every entry. Cancelling stops at the next file; what was removed stays removed.
pub fn clean_with(
    root: &Path,
    keys: Option<&[String]>,
    older_than: Duration,
    now: SystemTime,
    progress: &Progress<'_>,
) -> Result<CleanReport, String> {
    checked_root(root)?;
    let cutoff = now
        .checked_sub(older_than)
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let mut report = CleanReport::default();
    let mut chosen = Vec::new();
    for child in children(root)? {
        if keys.is_some_and(|keys| !keys.contains(&child.key)) {
            continue;
        }
        if child.modified.is_some_and(|changed| changed > cutoff) {
            report.kept += 1;
            continue;
        }
        chosen.push(child);
    }
    let total = chosen.len() as u64;
    let tally = Tally::default();
    let removed = par_map(chosen, |child| {
        if progress.cancelled() {
            return (child, None);
        }
        let removal = remove_tree(&child.path, progress);
        tally.finish(removal.freed, total, progress);
        (child, Some(removal))
    });
    for (child, removal) in removed {
        let Some(removal) = removal else {
            report.kept += 1;
            continue;
        };
        report.freed_bytes += removal.freed;
        let group = group_result(&mut report.groups, &child.key);
        group.freed_bytes += removal.freed;
        match removal.error {
            // Gone already (another process cleaned it) counts as removed: nothing to report.
            None => {
                report.removed += 1;
                group.removed += 1;
            }
            Some(error) if error.kind() == io::ErrorKind::NotFound => {
                report.removed += 1;
                group.removed += 1;
            }
            Some(error) => {
                report.kept += 1;
                if report.skipped.len() < MAX_SKIPPED_LISTED {
                    report.skipped.push(SkippedEntry {
                        name: child.name,
                        reason: error.to_string(),
                    });
                }
            }
        }
    }
    Ok(report)
}

/// The per-group line of a report for `key`, added on first use.
fn group_result<'a>(groups: &'a mut Vec<GroupResult>, key: &str) -> &'a mut GroupResult {
    let index = match groups.iter().position(|group| group.key == key) {
        Some(index) => index,
        None => {
            groups.push(GroupResult {
                key: key.to_string(),
                ..GroupResult::default()
            });
            groups.len() - 1
        }
    };
    &mut groups[index]
}

/// Progress for the callers that do not show any.
fn silent() -> Progress<'static> {
    static NEVER: AtomicBool = AtomicBool::new(false);
    Progress {
        on_step: &|_| {},
        cancel: &NEVER,
    }
}

#[cfg(test)]
#[path = "temp_cleanup_tests.rs"]
mod tests;
