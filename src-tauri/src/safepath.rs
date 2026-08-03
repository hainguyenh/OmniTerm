//! Workspace path containment.
//!
//! Ports Electron's `safeEditablePath` / `safeSubdir` (electron/core/workspaceHost.ts). The renderer
//! only ever hands back paths we handed it from a scan, but the backend re-validates so a
//! crafted/compromised webview request cannot read or write files outside the workspace the user
//! actually pinned. Symlinks are resolved before the containment check so a link planted inside the
//! workspace cannot point out of it.
//!
//! Three gates live here, and they are deliberately different widths:
//!
//!   * **run** (`LAUNCHABLE_EXTS`) — an allow-list. Executing the wrong file is the worst outcome.
//!   * **write** (`EDITABLE_EXTS`) — an allow-list. This app edits the scripts it manages, nothing else.
//!   * **view** (`VIEW_DENY_EXTS` + `sniff_text`) — a deny-list, because reading text is the harmless
//!     one and an allow-list would mean a code change for every format a user happens to keep in a
//!     project folder.
//!
//! Containment applies to all three. Widening the view gate must never widen the other two.

use std::fs;
use std::path::{Component, Path, PathBuf};

#[cfg(test)]
#[path = "safepath_tests.rs"]
mod tests;

/// Extensions the built-in provider will *write*. Everything else is read-only in the viewer —
/// notably `.rdp`, which is scanned and launchable but never editable.
///
/// Viewing is governed by `VIEW_DENY_EXTS` instead: the viewer opens any file that is plausibly text,
/// while saving stays limited to the executable scripts this app is actually a manager for.
pub const EDITABLE_EXTS: [&str; 4] = ["bat", "cmd", "ps1", "sh"];

/// Extensions the viewer refuses outright, checked before the file is opened.
///
/// A deny-list rather than an allow-list, so an unlisted text format (`.hcl`, `.nix`, a bare
/// `Dockerfile`) just works instead of needing a code change. `sniff_text` is the real backstop for
/// anything binary that slips through; this list is what makes the common cases fail *fast*, with a
/// specific message, without reading a 700 MB ISO off disk first.
///
/// Three groups, each here for its own reason:
///   * **Executables and containers** — nothing legible inside, and `.exe`/`.dll` is exactly what a
///     reviewer expects a file viewer to refuse.
///   * **Media, fonts, documents, databases** — binary containers whose text is not the file.
///   * **Key material** — `.pem`/`.key`/`.ppk` are plain text, so neither the extension groups above
///     nor `sniff_text` would stop them. Rendering a private key inside the app is not something this
///     viewer needs to do, and a viewer that does it is a finding waiting to be written up.
///
/// `.svg` and `.json` are deliberately absent — both are text their author edits by hand.
///
/// A slice rather than a sized array: the list grows whenever a format turns out to be worth refusing,
/// and a hardcoded length is just a second thing to update.
pub const VIEW_DENY_EXTS: &[&str] = &[
    // Executables, libraries, intermediate build output
    "exe", "msi", "msix", "appx", "dll", "so", "dylib", "com", "scr", "sys", "bin", "obj", "o", "a",
    "lib", "pdb", "wasm", "class", "pyc", "pyo", "node", "elf",
    // Archives and packages
    "zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "iso", "jar", "cab", "deb", "rpm",
    "dmg", "pkg", "whl", "nupkg", "pack",
    // Images, audio, video, fonts
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff", "avif", "mp3", "wav", "flac",
    "ogg", "mp4", "m4a", "avi", "mkv", "mov", "webm", "ttf", "otf", "woff", "woff2", "eot",
    // Binary document and database containers
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "db", "sqlite",
    "sqlite3", "mdb", "accdb",
    // Key material — text, so only this list keeps it out of the viewer
    "pem", "key", "crt", "cer", "pfx", "p12", "ppk", "asc", "gpg", "jks", "keystore",
];

/// Default cap on what the viewer/editor will open or save, when the user has set no preference.
///
/// 1 MiB covers every script and config file this app exists to manage, and keeps a giant-file read
/// from being turned into a memory-exhaustion lever. The user can raise it — see `clamp_max_bytes`.
pub const DEFAULT_MAX_VIEW_BYTES: u64 = 1024 * 1024;

/// Hard ceiling on the configured cap, whatever the settings file says.
///
/// The bytes are read into memory and then rendered as syntax-highlighted spans in a webview, so the
/// real cost of a large file is several times its size. 25 MiB is generous for a log and still short
/// of wedging the renderer; a settings file claiming 4 GiB gets clamped here rather than at the
/// allocation.
pub const MAX_VIEW_BYTES_CEILING: u64 = 25 * 1024 * 1024;

/// The fixed, non-editable half of the viewer's deny-list, for the Settings UI: it shows these
/// locked (with a lock icon) alongside the user's own additions, so "why can't I view a `.exe`" has an
/// answer without the user needing to guess whether it's their setting or the app's.
#[tauri::command]
pub fn system_excluded_view_exts() -> Vec<String> {
    VIEW_DENY_EXTS.iter().map(|s| s.to_string()).collect()
}

/// Coerce a configured byte cap into the supported range.
///
/// Applied at the point of use rather than at save time: settings are a partial-merge JSON blob that
/// an older build, a hand edit, or a future field could put anything into, and the read path is the
/// one place that cannot be bypassed.
pub fn clamp_max_bytes(configured: Option<u64>) -> u64 {
    configured
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_MAX_VIEW_BYTES)
        .min(MAX_VIEW_BYTES_CEILING)
}

/// Resolve symlinks and `..` into an absolute path, *without* Windows' `\\?\` verbatim prefix.
///
/// `dunce::canonicalize` is `fs::canonicalize` minus that prefix. The distinction matters because
/// these paths do not stay inside Rust: they are embedded in `cmd /c "<path>"` command lines and used
/// as a pane's working directory, and `cmd.exe` understands neither form of verbatim path — it read
/// `\\?\D:\ws\stop.bat` as a literal relative name and answered "is not recognized as an internal or
/// external command". `dunce` keeps the prefix only when the path genuinely needs it (>260 chars, or a
/// name cmd could not address anyway), so containment comparisons stay exact.
pub(crate) fn canonical(path: &Path) -> Result<PathBuf, String> {
    dunce::canonicalize(path).map_err(|e| format!("cannot resolve {}: {}", path.display(), e))
}

/// True if `candidate` is a strict descendant of `root`. Both must already be canonicalized.
fn is_inside(root: &Path, candidate: &Path) -> bool {
    candidate != root && candidate.starts_with(root)
}

/// Extensions the scanner surfaces as launchable. `.rdp` is launch-only — handed to the OS Remote
/// Desktop client rather than run as a script.
pub const LAUNCHABLE_EXTS: [&str; 5] = ["bat", "cmd", "ps1", "sh", "rdp"];

/// Resolve `script_path` and assert it is a strict descendant of `root`, with no extension check.
///
/// The containment half of `contained`, split out because the viewer's gate is a deny-list while the
/// run/edit gates are allow-lists. Both halves must keep running in both directions: containment is
/// what stops a crafted webview request from reaching outside the pinned workspace at all.
fn contained_path(root: &str, script_path: &str) -> Result<PathBuf, String> {
    let real_root = canonical(Path::new(root))?;
    let script_buf = Path::new(script_path);
    let target = if script_buf.is_relative() {
        real_root.join(script_buf)
    } else {
        script_buf.to_path_buf()
    };
    let real = canonical(&target)?;

    if !is_inside(&real_root, &real) {
        return Err("script is outside its workspace".to_string());
    }
    Ok(real)
}

/// Lowercased extension of an already-resolved path, or `""` for an extensionless name.
fn ext_of(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn contained(
    root: &str,
    script_path: &str,
    allowed_exts: &[&str],
    ext_error: &str,
) -> Result<PathBuf, String> {
    let real = contained_path(root, script_path)?;
    if !allowed_exts.contains(&ext_of(&real).as_str()) {
        return Err(ext_error.to_string());
    }
    Ok(real)
}

/// Resolve `script_path` and assert it lives inside `root` with an editable extension.
///
/// Returns the canonical path on success. Errors — rather than falling back to the raw path — on
/// anything outside the workspace, so a caller that ignores the Result cannot still touch the file.
pub fn safe_editable_path(root: &str, script_path: &str) -> Result<PathBuf, String> {
    contained(
        root,
        script_path,
        &EDITABLE_EXTS,
        "only executable scripts can be edited",
    )
}

/// Same containment check for a script we are about to *run*.
///
/// Electron only re-validated on the edit path. Running is the more consequential of the two, and the
/// renderer supplies `script.path` verbatim, so it is checked here too — the paths always originate
/// from our own scan, and anything else is a crafted request.
pub fn safe_runnable_path(root: &str, script_path: &str) -> Result<PathBuf, String> {
    contained(
        root,
        script_path,
        &LAUNCHABLE_EXTS,
        "only scanned scripts can be run",
    )
}

/// Resolve a relative `sub_path` under `root` and assert it stays inside the workspace and is a
/// directory. Used by "open a terminal here" on a subfolder.
///
/// `create` makes a missing `sub_path`, for callers that own the directory rather than only read it.
/// It has to happen in here: `canonical` fails on a path that is not there yet, so validating first
/// and creating afterwards could never create anything. Ordering keeps the guarantee intact — `root`
/// is canonicalized and `sub_path` rejected as absolute or traversing before anything is written, and
/// containment is re-checked against the canonical result, catching a symlink aimed out of the tree.
pub fn safe_subdir(root: &str, sub_path: &str, create: bool) -> Result<PathBuf, String> {
    let real_root = canonical(Path::new(root))?;

    // Reject absolute paths and `..` before touching the filesystem: `Path::join` silently discards
    // the root when handed an absolute path, so `join("C:\\Windows")` would escape without ever
    // looking like traversal.
    let candidate = Path::new(sub_path);
    if candidate.is_absolute()
        || candidate
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_) | Component::RootDir))
    {
        return Err("directory is outside its workspace".to_string());
    }

    let target = real_root.join(candidate);
    if create && !target.exists() {
        fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    }
    let real = canonical(&target)?;
    if !real.starts_with(&real_root) {
        return Err("directory is outside its workspace".to_string());
    }
    if !real.is_dir() {
        return Err("not a directory".to_string());
    }
    Ok(real)
}

/// Same check, additionally denying anything in `excluded` — the user's own "Excluded file types"
/// setting (GeneralSettings.tsx), layered on top of the fixed `VIEW_DENY_EXTS` list rather than
/// replacing it: a user can narrow what the viewer opens, never widen it past the built-in gate.
pub fn is_viewable_kind_excluding(kind_or_ext: &str, excluded: &[String]) -> bool {
    let ext = kind_or_ext.to_lowercase();
    !VIEW_DENY_EXTS.contains(&ext.as_str())
        && !excluded.iter().any(|e| e.eq_ignore_ascii_case(&ext))
}

/// Resolve `script_path` and assert it lives inside `root` and is not a kind the viewer refuses.
pub fn safe_viewable_path(root: &str, script_path: &str) -> Result<PathBuf, String> {
    safe_viewable_path_excluding(root, script_path, &[])
}

/// Same as `safe_viewable_path`, additionally denying the user's own excluded extensions.
pub fn safe_viewable_path_excluding(
    root: &str,
    script_path: &str,
    excluded: &[String],
) -> Result<PathBuf, String> {
    let real = contained_path(root, script_path)?;
    if !is_viewable_kind_excluding(&ext_of(&real), excluded) {
        return Err("this file type cannot be viewed as text".to_string());
    }
    Ok(real)
}

/// Render a byte count the way the size-limit message needs to read.
fn human_bytes(bytes: u64) -> String {
    const MIB: u64 = 1024 * 1024;
    const KIB: u64 = 1024;
    if bytes >= MIB {
        // One decimal, so a 2.3 MB file does not report as "2 MB" against a "2 MB" limit.
        format!("{:.1} MB", bytes as f64 / MIB as f64)
    } else if bytes >= KIB {
        format!("{} KB", bytes / KIB)
    } else {
        format!("{bytes} bytes")
    }
}

/// How many leading bytes `sniff_text` inspects for a NUL.
///
/// Bounded rather than whole-file so the check costs the same for a 20 MB log as for a 200-byte
/// script. Every binary format that matters puts a NUL in its header — this is a backstop for
/// something `VIEW_DENY_EXTS` did not name, not a classifier.
const SNIFF_BYTES: usize = 8 * 1024;

/// Decode bytes as text, refusing anything that reads as binary.
///
/// Two distinct rejections, because they are two distinct user-facing situations:
///   * a NUL byte early on means the file is binary despite its extension (a `.txt` that is really a
///     database, a stray `.log` that is a core dump);
///   * invalid UTF-8 means it is text in some other encoding — legacy code pages are common on
///     Windows — which is worth saying plainly instead of rendering as replacement characters.
///
/// No BOM stripping. A UTF-8 BOM is how `powershell.exe` recognizes an encoded script, and the editor
/// writes back exactly what it was handed, so removing one here would silently change what the shell
/// reads on the next run.
fn sniff_text(bytes: Vec<u8>) -> Result<String, String> {
    if bytes[..bytes.len().min(SNIFF_BYTES)].contains(&0) {
        return Err("this looks like a binary file, not text".to_string());
    }
    String::from_utf8(bytes)
        .map_err(|_| "this file is not valid UTF-8 text".to_string())
}

/// Read an in-workspace file as text for the viewer, bounded by `max_bytes`.
///
/// Wider than the edit path on purpose: any file that is not denied by kind and not binary can be
/// *read*, while `write_editable` still only accepts an executable script. The size check runs against
/// the metadata before the bytes are pulled into memory.
pub fn read_viewable(root: &str, script_path: &str, max_bytes: u64) -> Result<String, String> {
    read_viewable_excluding(root, script_path, max_bytes, &[])
}

/// Same as `read_viewable`, additionally denying the user's own excluded extensions.
pub fn read_viewable_excluding(
    root: &str,
    script_path: &str,
    max_bytes: u64,
    excluded: &[String],
) -> Result<String, String> {
    let real = safe_viewable_path_excluding(root, script_path, excluded)?;
    let size = fs::metadata(&real).map_err(|e| e.to_string())?.len();
    if size > max_bytes {
        return Err(format!(
            "This file is {} and the viewer limit is {}. Raise \"Max file size to open\" in Settings to view it.",
            human_bytes(size),
            human_bytes(max_bytes)
        ));
    }
    sniff_text(fs::read(&real).map_err(|e| e.to_string())?)
}

/// Write an in-workspace script, bounded by `max_bytes`.
///
/// Shares the caller's cap with `read_viewable` deliberately: two independent limits meant a file the
/// viewer had opened could be one the editor then refused to save, and the user only discovered it
/// after typing.
pub fn write_editable(
    root: &str,
    script_path: &str,
    content: &str,
    max_bytes: u64,
) -> Result<(), String> {
    if content.len() as u64 > max_bytes {
        return Err(format!(
            "This content is {} and the save limit is {}.",
            human_bytes(content.len() as u64),
            human_bytes(max_bytes)
        ));
    }
    let real = safe_editable_path(root, script_path)?;
    fs::write(&real, content).map_err(|e| e.to_string())
}

