//! IPC for "Clean Temp Files": group what is in the user's temp folder and remove the old entries
//! of the groups the user picks. The logic lives in `app_core::temp_cleanup`; the folder is always
//! the OS temp dir, never a path from the webview.

use app_core::temp_cleanup::{clean, scan, CleanReport, TempGroup};
use std::time::{Duration, SystemTime};

/// The most groups one clean call accepts; a scan never has more than the folder has kinds.
const MAX_KEYS: usize = 4096;
/// Ten years: anything older is "everything" for a temp folder.
const MAX_AGE_HOURS: u32 = 24 * 365 * 10;

/// The groups in the temp folder, the biggest first.
#[tauri::command]
pub async fn temp_cleanup_scan() -> Result<Vec<TempGroup>, String> {
    let root = std::env::temp_dir();
    tauri::async_runtime::spawn_blocking(move || scan(&root))
        .await
        .map_err(|error| format!("Temp scan failed: {error}"))?
}

/// Removes entries of `keys` (from `temp_cleanup_scan`) not changed for `older_than_hours`.
/// Whatever cannot be removed is skipped and listed in the report.
#[tauri::command]
pub async fn temp_cleanup_run(
    keys: Vec<String>,
    older_than_hours: u32,
) -> Result<CleanReport, String> {
    if keys.is_empty() || keys.len() > MAX_KEYS || keys.iter().any(|key| key.len() > 512) {
        return Err("Invalid group list.".to_string());
    }
    let older_than = Duration::from_secs(u64::from(older_than_hours.min(MAX_AGE_HOURS)) * 3600);
    let root = std::env::temp_dir();
    tauri::async_runtime::spawn_blocking(move || {
        clean(&root, Some(&keys), older_than, SystemTime::now())
    })
    .await
    .map_err(|error| format!("Temp clean-up failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_or_oversized_group_list_is_refused() {
        let empty = tauri::async_runtime::block_on(temp_cleanup_run(Vec::new(), 0));
        assert!(empty.is_err());
        let long = tauri::async_runtime::block_on(temp_cleanup_run(vec!["k".repeat(513)], 0));
        assert!(long.is_err());
        let many = tauri::async_runtime::block_on(temp_cleanup_run(
            vec!["k".to_string(); MAX_KEYS + 1],
            0,
        ));
        assert!(many.is_err());
    }
}
