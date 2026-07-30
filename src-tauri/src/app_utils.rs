//! Log helpers, version/platform reporting, and the guarded external-link opener.
//!
//! Ports the `app:*` handlers from electron/main.ts. Return types match the declarations in
//! src/vite-env.d.ts (`revealLog: Promise<string>`, `clearLog`/`openExternal`/`cleanupRdpCert`:
//! `Promise<boolean>`) — the first port returned unit from all four, so the renderer's truthiness
//! checks always read false.

use std::fs;
use tauri::{AppHandle, Manager};

#[cfg(test)]
#[path = "app_utils_tests.rs"]
mod tests;

/// GitHub path prefix external opens are limited to. Empty disables external opens entirely, which is
/// the current state in electron/main.ts (`const RELEASE_REPO_PATH = ''`).
const RELEASE_REPO_PATH: &str = "";

/// Host external links are limited to.
const RELEASE_HOST: &str = "github.com";

/// True if `url` may be handed to the OS.
///
/// The first port passed the renderer's string straight to `opener::open`, which launches whatever the
/// OS associates with it — so `open_external("C:\\evil.exe")`, a `file://` URL, or any custom protocol
/// handler became arbitrary program execution driven by the webview. Electron restricted this to
/// HTTPS release pages, and so does this.
pub fn is_allowed_external(url: &str) -> bool {
    // Not configured → external opens are disabled, matching the Electron build.
    if RELEASE_REPO_PATH.is_empty() {
        return false;
    }

    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    // Split host[:port] from the path. A URL with no path can never match a path prefix.
    let Some((authority, path)) = rest.split_once('/') else {
        return false;
    };
    // Rejects embedded credentials (`https://github.com@evil.test/…`) along with any other host,
    // since the whole authority must equal the release host.
    if authority != RELEASE_HOST {
        return false;
    }
    format!("/{path}").starts_with(RELEASE_REPO_PATH)
}

/// True if `url` may be handed to the OS on a *plugin's* behalf.
///
/// Deliberately not `is_allowed_external`: that one is pinned to the release page on `github.com`, so
/// reusing it would refuse the one thing a plugin legitimately needs this for — opening the vault page
/// where a password lives (`credentialMode: 'url'`), so the user copies it instead of OmniTerm storing
/// it. The host cannot know which vault a deployment uses, so the host is not the allowlist.
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
pub async fn reveal_log(app: AppHandle) -> Result<String, String> {
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
pub async fn clear_log(app: AppHandle) -> Result<bool, String> {
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
pub async fn open_external(url: String) -> Result<bool, String> {
    if !is_allowed_external(&url) {
        log::warn!("[app] refused to open an external URL outside the allowlist");
        return Ok(false);
    }
    opener::open(&url).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn get_version(app: AppHandle) -> Result<String, String> {
    Ok(app.package_info().version.to_string())
}

#[tauri::command]
pub async fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "Could not find home directory".to_string())
}

/// Reported using Node's `process.platform` values, which is what the renderer branches on.
#[tauri::command]
pub async fn get_platform() -> Result<String, String> {
    Ok(current_platform().to_string())
}

pub fn current_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

/// RDP certificate cleanup is Phase 3 work; there is nothing to clean up yet.
#[tauri::command]
pub async fn cleanup_rdp_cert() -> Result<bool, String> {
    Ok(true)
}
