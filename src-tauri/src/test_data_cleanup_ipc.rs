//! IPC for Clean Up › Test Data: the folders OmniTerm's own test runs left in the per-user data
//! folders (`app_core::test_data_cleanup`). A clean-up only accepts folders the last scan
//! reported, never a path the webview made up, and the core checks each one again before removing
//! it.

use app_core::test_data_cleanup::{
    creator_running, find_leftovers, remove_leftovers, LeftoverDir, LeftoverRemoval,
};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

/// The folders the last scan reported: the only ones a clean-up may touch.
static SCANNED: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());

fn scanned() -> std::sync::MutexGuard<'static, BTreeSet<PathBuf>> {
    SCANNED
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The per-user folders an app's own data folders sit in (roaming and local app data, config,
/// cache and logs): where a mock app named after a test process creates its folders too.
pub(crate) fn data_parents<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let identifier = app.config().identifier.clone();
    let paths = app.path();
    let dirs = [
        paths.app_data_dir(),
        paths.app_local_data_dir(),
        paths.app_config_dir(),
        paths.app_cache_dir(),
        paths.app_log_dir(),
    ];
    let mut parents: Vec<PathBuf> = Vec::new();
    for dir in dirs.into_iter().flatten() {
        if let Some(parent) = parent_of_app_folder(&dir, &identifier) {
            if !parents.contains(&parent) {
                parents.push(parent);
            }
        }
    }
    parents
}

/// The folder holding the app's own folder (named `identifier`) on the way up from `dir`.
fn parent_of_app_folder(dir: &Path, identifier: &str) -> Option<PathBuf> {
    dir.ancestors()
        .find(|a| a.file_name().is_some_and(|n| n == identifier))
        .and_then(Path::parent)
        .map(Path::to_path_buf)
}

/// The test-run folders whose process has ended.
#[tauri::command]
pub async fn test_data_cleanup_scan<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<LeftoverDir>, String> {
    let parents = data_parents(&app);
    let found =
        tauri::async_runtime::spawn_blocking(move || find_leftovers(&parents, &creator_running))
            .await
            .map_err(|error| format!("Test data scan failed: {error}"))?;
    *scanned() = found.iter().map(|d| PathBuf::from(&d.path)).collect();
    Ok(found)
}

/// Removes `paths` (folders from the last scan).
#[tauri::command]
pub async fn test_data_cleanup_run(paths: Vec<String>) -> Result<Vec<LeftoverRemoval>, String> {
    let chosen = known_paths(&paths, &scanned())?;
    tauri::async_runtime::spawn_blocking(move || remove_leftovers(&chosen, &creator_running))
        .await
        .map_err(|error| format!("Test data clean-up failed: {error}"))
}

/// `paths` as paths, each one the last scan reported; anything else refuses the whole call.
fn known_paths(paths: &[String], scanned: &BTreeSet<PathBuf>) -> Result<Vec<PathBuf>, String> {
    if paths.is_empty() {
        return Err("No folder chosen.".to_string());
    }
    paths
        .iter()
        .map(|raw| {
            let path = PathBuf::from(raw);
            if scanned.contains(&path) {
                Ok(path)
            } else {
                Err(format!(
                    "\"{raw}\" was not found by the last scan. Scan again."
                ))
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clean_up_accepts_only_folders_the_scan_reported() {
        let scanned: BTreeSet<PathBuf> = [PathBuf::from(
            "C:/Users/u/AppData/Roaming/com.omniterm.tests.7",
        )]
        .into();
        assert_eq!(
            known_paths(
                &["C:/Users/u/AppData/Roaming/com.omniterm.tests.7".to_string()],
                &scanned
            ),
            Ok(vec![PathBuf::from(
                "C:/Users/u/AppData/Roaming/com.omniterm.tests.7"
            )])
        );
        assert!(known_paths(&["C:/Users/u/AppData/Roaming".to_string()], &scanned).is_err());
        assert!(known_paths(&[], &scanned).is_err());
    }

    #[test]
    fn the_parent_is_the_folder_above_the_app_folder() {
        let id = "com.omniterm.app";
        assert_eq!(
            parent_of_app_folder(Path::new("/home/u/.local/share/com.omniterm.app"), id),
            Some(PathBuf::from("/home/u/.local/share"))
        );
        assert_eq!(
            parent_of_app_folder(Path::new("/l/com.omniterm.app/logs"), id),
            Some(PathBuf::from("/l"))
        );
        assert_eq!(
            parent_of_app_folder(Path::new("/home/u/Library/Logs/other"), id),
            None
        );
    }

    #[test]
    fn the_data_parents_of_a_mock_app_hold_its_folders() {
        let _guard = crate::test_support::lock();
        let app = crate::test_support::mock_app();
        let parents = data_parents(app.handle());
        assert!(!parents.is_empty());
        let data = app.path().app_data_dir().expect("mock app data path");
        assert!(
            parents.iter().any(|p| data.parent() == Some(p.as_path())),
            "{parents:?}"
        );
    }
}
