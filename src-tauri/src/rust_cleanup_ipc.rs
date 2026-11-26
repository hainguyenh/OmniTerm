//! IPC for Clean Up › Rust. The search and sizing live in `app_core::rust_cleanup`. A clean-up
//! only accepts build folders the last scan reported, never a path the webview made up, and the
//! core checks each one is still a Cargo build folder before removing anything. Both walks report
//! `rust-cleanup:progress` events and stop on `rust_cleanup_cancel`.

use app_core::rust_cleanup::{
    clean_with, find_projects, measure_with, Progress, RustCleanMode, RustCleanResult, RustTarget,
};
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Runtime};

use crate::cleanup_progress::ProgressEmitter;

const PROGRESS_EVENT: &str = "rust-cleanup:progress";

/// Set by `rust_cleanup_cancel`; cleared when a scan or clean-up starts (one runs at a time).
static CANCEL: AtomicBool = AtomicBool::new(false);

/// The build folders the last scan reported: the only ones a clean-up may touch.
static SCANNED: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());

fn scanned() -> std::sync::MutexGuard<'static, BTreeSet<PathBuf>> {
    SCANNED
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The Cargo projects with a build folder under the workspaces and `extra_roots`, biggest first.
#[tauri::command]
pub async fn rust_cleanup_scan<R: Runtime>(
    app: AppHandle<R>,
    extra_roots: Vec<String>,
) -> Result<Vec<RustTarget>, String> {
    let roots = crate::cleanup_roots::scan_roots(&app, &extra_roots)?;
    CANCEL.store(false, Ordering::Relaxed);
    let emitter = ProgressEmitter::new(app, PROGRESS_EVENT, "scan");
    let targets = tauri::async_runtime::spawn_blocking(move || {
        let step = |step| emitter.step(step);
        let progress = Progress {
            on_step: &step,
            cancel: &CANCEL,
        };
        let projects = find_projects(&roots, &progress);
        measure_with(projects, &progress)
    })
    .await
    .map_err(|error| format!("Rust scan failed: {error}"))?;
    *scanned() = targets.iter().map(|t| PathBuf::from(&t.target)).collect();
    Ok(targets)
}

/// Removes `mode`'s part of each of `targets` (build folders from the last scan).
#[tauri::command]
pub async fn rust_cleanup_run<R: Runtime>(
    app: AppHandle<R>,
    targets: Vec<String>,
    mode: RustCleanMode,
) -> Result<Vec<RustCleanResult>, String> {
    let chosen = known_targets(&targets, &scanned())?;
    CANCEL.store(false, Ordering::Relaxed);
    let emitter = ProgressEmitter::new(app, PROGRESS_EVENT, "clean");
    tauri::async_runtime::spawn_blocking(move || {
        let step = |step| emitter.step(step);
        clean_with(
            chosen,
            mode,
            &Progress {
                on_step: &step,
                cancel: &CANCEL,
            },
        )
    })
    .await
    .map_err(|error| format!("Rust clean-up failed: {error}"))
}

/// Stops the running scan or clean-up at its next file; what was removed stays removed.
#[tauri::command]
pub fn rust_cleanup_cancel() {
    CANCEL.store(true, Ordering::Relaxed);
}

/// `targets` as paths, each one the last scan reported; anything else refuses the whole call.
fn known_targets(targets: &[String], scanned: &BTreeSet<PathBuf>) -> Result<Vec<PathBuf>, String> {
    if targets.is_empty() {
        return Err("No build folder chosen.".to_string());
    }
    targets
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
    fn a_clean_up_accepts_only_build_folders_the_scan_reported() {
        let scanned: BTreeSet<PathBuf> = [PathBuf::from("D:/code/app/target")].into();
        assert_eq!(
            known_targets(&["D:/code/app/target".to_string()], &scanned),
            Ok(vec![PathBuf::from("D:/code/app/target")])
        );
        assert!(known_targets(&["C:/Windows".to_string()], &scanned).is_err());
        assert!(known_targets(&[], &scanned).is_err());
    }
}
