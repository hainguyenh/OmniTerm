//! IPC for "Clean Temp Files": group what is in the user's temp folder and remove the old entries
//! of the groups the user picks. The logic lives in `app_core::temp_cleanup`; the folder is always
//! the OS temp dir, never a path from the webview. Both walks report progress as
//! `temp-cleanup:progress` events and stop on `temp_cleanup_cancel`.

use app_core::temp_cleanup::{clean_with, scan_with, CleanReport, Progress, TempGroup};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Runtime};

use crate::cleanup_progress::ProgressEmitter;

/// The most groups one clean call accepts; a scan never has more than the folder has kinds.
const MAX_KEYS: usize = 4096;
/// Ten years: anything older is "everything" for a temp folder.
const MAX_AGE_HOURS: u32 = 24 * 365 * 10;

const PROGRESS_EVENT: &str = "temp-cleanup:progress";

/// Set by `temp_cleanup_cancel`; cleared when a scan or clean-up starts (the dialog runs one at a time).
static CANCEL: AtomicBool = AtomicBool::new(false);

/// The groups in the temp folder, the biggest first.
#[tauri::command]
pub async fn temp_cleanup_scan<R: Runtime>(app: AppHandle<R>) -> Result<Vec<TempGroup>, String> {
    let root = std::env::temp_dir();
    CANCEL.store(false, Ordering::Relaxed);
    let emitter = ProgressEmitter::new(app, PROGRESS_EVENT, "scan");
    tauri::async_runtime::spawn_blocking(move || {
        let step = |step| emitter.step(step);
        scan_with(
            &root,
            &Progress {
                on_step: &step,
                cancel: &CANCEL,
            },
        )
    })
    .await
    .map_err(|error| format!("Temp scan failed: {error}"))?
}

/// Removes entries of `keys` (from `temp_cleanup_scan`) not changed for `older_than_hours`.
/// Whatever cannot be removed is skipped and listed in the report.
#[tauri::command]
pub async fn temp_cleanup_run<R: Runtime>(
    app: AppHandle<R>,
    keys: Vec<String>,
    older_than_hours: u32,
) -> Result<CleanReport, String> {
    validate_keys(&keys)?;
    let older_than = Duration::from_secs(u64::from(older_than_hours.min(MAX_AGE_HOURS)) * 3600);
    let root = std::env::temp_dir();
    CANCEL.store(false, Ordering::Relaxed);
    let emitter = ProgressEmitter::new(app, PROGRESS_EVENT, "clean");
    tauri::async_runtime::spawn_blocking(move || {
        let step = |step| emitter.step(step);
        clean_with(
            &root,
            Some(&keys),
            older_than,
            SystemTime::now(),
            &Progress {
                on_step: &step,
                cancel: &CANCEL,
            },
        )
    })
    .await
    .map_err(|error| format!("Temp clean-up failed: {error}"))?
}

/// Stops the running scan or clean-up at its next file; what was removed stays removed.
#[tauri::command]
pub fn temp_cleanup_cancel() {
    CANCEL.store(true, Ordering::Relaxed);
}

fn validate_keys(keys: &[String]) -> Result<(), String> {
    if keys.is_empty() || keys.len() > MAX_KEYS || keys.iter().any(|key| key.len() > 512) {
        return Err("Invalid group list.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_or_oversized_group_list_is_refused() {
        assert!(validate_keys(&[]).is_err());
        assert!(validate_keys(&["k".repeat(513)]).is_err());
        assert!(validate_keys(&vec!["k".to_string(); MAX_KEYS + 1]).is_err());
        assert!(validate_keys(&["claude-*".to_string()]).is_ok());
    }
}
