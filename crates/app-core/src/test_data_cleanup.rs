//! Folders that OmniTerm's own test runs leave in the user's app-data folders.
//!
//! The desktop adapter's tests build mock apps named `com.omniterm.tests.<pid>`, and Tauri creates
//! that folder under each per-user data folder (roaming and local app data on Windows). A test
//! process cannot remove its own folders when it ends, so they pile up: one set per `cargo test`
//! run. [`find_leftovers`] lists the ones whose process has ended and [`remove_leftovers`] deletes
//! them. A folder of a process that is still running is never touched, nor any folder whose name
//! is not exactly the prefix followed by a process ID.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::parallel::Progress;
use crate::temp_cleanup::{measure, remove_tree};

/// What the test fixtures name their mock apps, followed by the test process ID.
pub const TEST_DATA_PREFIX: &str = "com.omniterm.tests.";

/// A test run's folder whose process has ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeftoverDir {
    pub path: String,
    pub pid: u32,
    pub files: u64,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeftoverRemoval {
    pub path: String,
    pub freed_bytes: u64,
    pub error: Option<String>,
}

/// The test process ID in a folder name, when the name is exactly the prefix and a number.
pub fn test_run_pid(name: &str) -> Option<u32> {
    let digits = name.strip_prefix(TEST_DATA_PREFIX)?;
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// The test-run folders directly inside `parents` whose process `creator_running` says has ended,
/// sorted by path. A parent that cannot be read is skipped.
pub fn find_leftovers(
    parents: &[PathBuf],
    creator_running: &dyn Fn(u32, &Path) -> bool,
) -> Vec<LeftoverDir> {
    let cancel = AtomicBool::new(false);
    let progress = Progress {
        on_step: &|_| {},
        cancel: &cancel,
    };
    let mut found = Vec::new();
    for parent in parents {
        let Ok(entries) = fs::read_dir(parent) else {
            continue;
        };
        for entry in entries.flatten() {
            let Some(pid) = entry.file_name().to_str().and_then(test_run_pid) else {
                continue;
            };
            // A link is not a folder a test created; leave it alone.
            let path = entry.path();
            if !entry.file_type().is_ok_and(|t| t.is_dir()) || creator_running(pid, &path) {
                continue;
            }
            let (files, bytes) = measure(&path, true, 0, &progress);
            found.push(LeftoverDir {
                path: path.to_string_lossy().into_owned(),
                pid,
                files,
                bytes,
            });
        }
    }
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found
}

/// Deletes each of `paths`, checking again that it is a test-run folder whose process has ended.
pub fn remove_leftovers(
    paths: &[PathBuf],
    creator_running: &dyn Fn(u32, &Path) -> bool,
) -> Vec<LeftoverRemoval> {
    let cancel = AtomicBool::new(false);
    let progress = Progress {
        on_step: &|_| {},
        cancel: &cancel,
    };
    paths
        .iter()
        .map(|path| {
            let shown = path.to_string_lossy().into_owned();
            match refusal(path, creator_running) {
                Some(reason) => LeftoverRemoval {
                    path: shown,
                    freed_bytes: 0,
                    error: Some(reason),
                },
                None => {
                    let removal = remove_tree(path, &progress);
                    LeftoverRemoval {
                        path: shown,
                        freed_bytes: removal.freed,
                        error: removal.error.map(|e| e.to_string()),
                    }
                }
            }
        })
        .collect()
}

/// Why `path` must not be removed, if it must not.
fn refusal(path: &Path, creator_running: &dyn Fn(u32, &Path) -> bool) -> Option<String> {
    let Some(pid) = path
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(test_run_pid)
    else {
        return Some("not a test-run folder".to_string());
    };
    if creator_running(pid, path) {
        return Some(format!("test process {pid} is still running"));
    }
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => None,
        Ok(_) => Some("not a folder".to_string()),
        Err(error) => Some(error.to_string()),
    }
}

/// Whether the test process `pid` that created `folder` is still running. Windows reuses process
/// IDs: a running process that started after the folder existed cannot have created it.
pub fn creator_running(pid: u32, folder: &Path) -> bool {
    let Some(started) = process_start(pid) else {
        return false;
    };
    let Some(created) = fs::metadata(folder)
        .and_then(|m| m.created().or_else(|_| m.modified()))
        .ok()
    else {
        return true;
    };
    could_create(started, created)
}

/// Whether a process that started at `started` can have created a folder at `created`. Start
/// times have whole-second precision, hence the slack.
fn could_create(started: SystemTime, created: SystemTime) -> bool {
    started <= created + Duration::from_secs(2)
}

/// When the process with ID `pid` started, if one is running.
fn process_start(pid: u32) -> Option<SystemTime> {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    let target = Pid::from_u32(pid);
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[target]),
        true,
        ProcessRefreshKind::nothing(),
    );
    let process = sys.process(target)?;
    Some(UNIX_EPOCH + Duration::from_secs(process.start_time()))
}

#[cfg(test)]
#[path = "test_data_cleanup_tests.rs"]
mod tests;
