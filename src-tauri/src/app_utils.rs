//! Log helpers, version/platform reporting, and plugin URL validation.
//!
//! Ports the implemented `app:*` handlers from electron/main.ts. Unimplemented update and RDP
//! cleanup placeholders are deliberately not registered as production commands.

use std::fs;
use tauri::{AppHandle, Manager, Runtime};

#[cfg(test)]
#[path = "app_utils_tests.rs"]
mod tests;

/// True if `url` may be handed to the OS on a *plugin's* behalf.
///
/// The host cannot know which approved documentation or company vault a deployment uses, so the host is not the allowlist.
///
/// What it still refuses is the part that made the unguarded version arbitrary program execution: any
/// scheme other than https (no `file:`, no custom protocol handler, no bare Windows path), and any
/// authority carrying credentials or a `@` — `https://github.com@evil.test/…` reads as `github.com`
/// to a human and resolves to `evil.test`.
pub fn is_allowed_plugin_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    // Authority is everything up to the first `/`, `?` or `#`; a URL may legitimately have no path.
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return false;
    }
    // A control character or whitespace in the authority means the string was not a URL to begin
    // with; some openers split on it and act on the remainder.
    !authority.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// Whether this build keeps a log at all — true only with debug assertions on.
///
/// A release or portable build registers no logger (see lib.rs) and compiles its `log::*!` call sites
/// away (see Cargo.toml), so there is never a file to reveal. The commands below check this *before*
/// touching the filesystem: the previous `reveal_log` called `create_dir_all`, which meant asking to
/// see the log in a packaged build created an `OmniTerm/logs` directory that nothing would ever write
/// to — a write, on a build that is supposed to perform none.
pub const fn logging_enabled() -> bool {
    cfg!(debug_assertions)
}

/// Returned to the renderer instead of a path. It shows this verbatim only if it chooses to; the
/// "Open log" control is hidden in a packaged build (see MainLayout.tsx).
const LOGGING_DISABLED: &str = "This build keeps no log.";

#[tauri::command]
pub async fn reveal_log<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    if !logging_enabled() {
        return Err(LOGGING_DISABLED.to_string());
    }
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    if !log_dir.exists() {
        fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    }
    opener::open(&log_dir).map_err(|e| e.to_string())?;
    Ok(log_dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn clear_log<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    // Vacuously true: there is nothing to clear, and no reason to read the directory to find out.
    if !logging_enabled() {
        return Ok(true);
    }
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    if !log_dir.exists() {
        return Ok(true);
    }
    let entries = fs::read_dir(&log_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            fs::write(entry.path(), "").map_err(|e| e.to_string())?;
        }
    }
    Ok(true)
}

#[tauri::command]
pub async fn get_version<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    Ok(app.package_info().version.to_string())
}
