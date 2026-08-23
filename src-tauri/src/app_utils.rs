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
    app.state::<crate::os_actions::ExternalLauncherState>()
        .open_folder(&log_dir)?;
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
pub async fn get_version<R: Runtime>(_app: AppHandle<R>) -> Result<String, String> {
    // `env!("CARGO_PKG_VERSION")` is baked in at compile time directly from src-tauri/Cargo.toml.
    // Tauri's `package_info().version` reads from tauri.conf.json instead — a separate file that
    // can drift. Using the Cargo macro keeps both this command and the IPC test pointing at the
    // same single source of truth regardless of tauri.conf.json's state.
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

/// Validate that `path` is a safe non-URL local filesystem path that may be opened with the OS's
/// default handler. Returned string is the trimmed path the call should open.
///
/// URLs are refused absolutely: the renderer's link/path overlay menu (see `createTerminalContextMenu`
/// / `TerminalViewLinkMenuHost.openUrl`) routes `https://…` through its own path, and `file:///…` /
/// `mailto:…` / custom schemes would otherwise become arbitrary program execution via the OS's
/// registered protocol handler (see `is_allowed_plugin_url` for the same risk on the plugin side).
fn validate_path_for_open(path: &str) -> Result<&str, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty.".to_string());
    }
    if trimmed.contains("://") {
        return Err("URLs are not routed through open_in_system.".to_string());
    }
    // Refuse URL schemes that lack an authority (`mailto:`, `tel:`, custom protocol schemes) so the
    // OS's protocol handler cannot be invoked through the terminal's link menu. The `://` check
    // above only catches authority-style URLs. A Windows drive letter followed by a path separator
    // (`X:\` or `X:/`) is the one colon-led prefix that must still pass as a path.
    if let Some(idx) = trimmed.find(':') {
        let scheme = &trimmed[..idx];
        let after_is_path_sep = trimmed[idx + 1..].starts_with(['/', '\\']);
        let is_windows_drive =
            scheme.len() == 1 && scheme.starts_with(|c: char| c.is_ascii_alphabetic()) && after_is_path_sep;
        let is_url_scheme = !scheme.is_empty()
            && scheme.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.'));
        if is_url_scheme && !is_windows_drive {
            return Err("URLs are not routed through open_in_system.".to_string());
        }
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("Path contains control characters.".to_string());
    }
    Ok(trimmed)
}

/// Open a local file or directory with the OS's default handler (Explorer/Finder/xdg-open), the way
/// `reveal_log` opens the log directory. URL inputs are refused beforehand — see the guard above.
#[tauri::command]
pub async fn open_in_system(path: String) -> Result<(), String> {
    let validated = validate_path_for_open(&path)?;
    opener::open(validated).map_err(|e| e.to_string())
}

/// Persist pasted clipboard image bytes as a PNG in the OS temp directory and
/// return the absolute path, so terminal agents can attach it by path. The
/// renderer never names the file — this command owns naming and location.
#[tauri::command]
pub async fn save_temp_image<R: Runtime>(_app: AppHandle<R>, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("Clipboard image payload is empty.".to_string());
    }
    let path = std::env::temp_dir().join(format!("omniterm-paste-{}.png", chrono_like_stamp()));
    fs::write(&path, &bytes).map_err(|error| format!("Could not write pasted image: {error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Millisecond timestamp strong enough to avoid paste-file collisions.
fn chrono_like_stamp() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}
