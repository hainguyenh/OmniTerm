//! Structural edits inside a workspace folder: creating a subfolder, and renaming, moving or
//! deleting a file from the workspace tree.
//!
//! Every operation resolves the entry's *parent* directory with symlinks followed, requires it to be
//! the workspace root or inside it, and then acts on `<real parent>/<name>` itself. A symlink planted
//! in the tree is therefore renamed or deleted as a link; the file it points at is never touched.
//!
//! Directories are only ever created here. Renaming, moving and deleting are limited to files, so a
//! mistaken click in the tree cannot take a whole folder with it.

use std::ffi::{OsStr, OsString};
use std::fs::{self, File, OpenOptions};
use std::io::{self, ErrorKind};
use std::path::{Component, Path, PathBuf};

use crate::safepath;

#[cfg(test)]
#[path = "workspace_fs_tests.rs"]
mod tests;

const OUTSIDE: &str = "entry is outside its workspace";
const EXISTS: &str = "A file or folder with this name already exists.";

/// Characters Windows refuses in a name. Refused on every platform so a workspace folder stays
/// usable when the same directory is opened from another OS.
const RESERVED_CHARS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Device names Windows resolves before the filesystem, with or without an extension.
const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// One tree entry, resolved against its workspace folder.
struct Entry {
    /// Canonical workspace folder root.
    root: PathBuf,
    /// Canonical parent joined with the entry's own, unresolved name.
    path: PathBuf,
    name: OsString,
    /// The caller's path, normalized to `/` separators: what the tree shows, symlinks unresolved.
    relative: String,
}

/// Resolve `path` (relative to `root`) to an entry whose parent is the root or inside it.
///
/// Absolute paths, `..` and drive prefixes are refused before anything is resolved: `Path::join`
/// discards the root when handed an absolute path, so those would escape without looking like it.
fn resolve_entry(root: &str, path: &str) -> Result<Entry, String> {
    let real_root = safepath::canonical(Path::new(root))?;
    let mut parts = Vec::new();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(part) => parts.push(part),
            Component::CurDir => {}
            _ => return Err(OUTSIDE.to_string()),
        }
    }
    let Some((name, parents)) = parts.split_last() else {
        return Err(OUTSIDE.to_string());
    };
    let parent = parents
        .iter()
        .fold(real_root.clone(), |dir, part| dir.join(part));
    let real_parent = safepath::canonical(&parent)?;
    if real_parent != real_root && !safepath::is_inside(&real_root, &real_parent) {
        return Err(OUTSIDE.to_string());
    }
    let relative = parts
        .iter()
        .map(|part| part.to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    Ok(Entry {
        path: real_parent.join(name),
        root: real_root,
        name: name.to_os_string(),
        relative,
    })
}

/// Refuse a name the user is about to give a new or renamed entry.
fn validate_new_name(name: &OsStr) -> Result<(), String> {
    let name = name
        .to_str()
        .ok_or_else(|| "Names must be valid Unicode text.".to_string())?;
    if name.trim().is_empty() {
        return Err("Name cannot be empty.".to_string());
    }
    if name
        .chars()
        .any(|c| c.is_control() || RESERVED_CHARS.contains(&c))
    {
        return Err("Names cannot contain \\ / : * ? \" < > | or control characters.".to_string());
    }
    // Windows silently strips these, so the entry would not get the name that was asked for.
    if name.ends_with(['.', ' ']) {
        return Err("Names cannot end with a space or a period.".to_string());
    }
    let stem = name.split('.').next().unwrap_or(name).trim_end();
    if RESERVED_NAMES
        .iter()
        .any(|reserved| reserved.eq_ignore_ascii_case(stem))
    {
        return Err(format!("\"{name}\" is a reserved name on Windows."));
    }
    Ok(())
}

/// The webview may already write any viewable kind (`text_file`). Letting it rename such a file
/// into an executable, archive or key file would widen that write gate, so a rename may keep the
/// file's own extension or pick another viewable one — never a kind the viewer refuses.
fn ensure_kind_allowed(source: &Path, target: &Path) -> Result<(), String> {
    let from = safepath::ext_of(source);
    let to = safepath::ext_of(target);
    if from == to || safepath::is_viewable_kind_excluding(&to, &[]) {
        return Ok(());
    }
    Err(format!(
        "A file cannot be renamed to a .{to} file from the workspace tree."
    ))
}

fn missing_or(error: io::Error, context: &str) -> String {
    if error.kind() == ErrorKind::NotFound {
        "That file no longer exists.".to_string()
    } else {
        format!("{context}: {error}")
    }
}

/// True when `a` and `b` name one directory entry — a rename that only changes letter case.
#[cfg(unix)]
fn same_entry(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (fs::symlink_metadata(a), fs::symlink_metadata(b)) {
        (Ok(left), Ok(right)) => left.dev() == right.dev() && left.ino() == right.ino(),
        _ => false,
    }
}

/// True when `a` and `b` name one directory entry — a rename that only changes letter case.
///
/// std exposes no stable file id on Windows. Its filesystems are case-insensitive by default, so a
/// destination in the same directory whose name differs only in case is the source itself.
#[cfg(not(unix))]
fn same_entry(a: &Path, b: &Path) -> bool {
    let folded = |path: &Path| {
        path.file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
    };
    a.parent() == b.parent() && folded(a) == folded(b)
}

/// Copy `source` to a `target` that must not exist yet — `create_new` refuses a file that appeared
/// since the caller's existence check.
fn copy_to_new(source: &Path, target: &Path) -> io::Result<()> {
    let mut reader = File::open(source)?;
    let mut writer = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)?;
    io::copy(&mut reader, &mut writer)?;
    writer.sync_all()?;
    fs::set_permissions(target, fs::metadata(source)?.permissions())
}

/// Workspace folders can sit on different drives, where a rename cannot cross. Copy, then remove
/// the original; when the original cannot be removed the copy goes again, so the move fails whole
/// instead of leaving the file in two places.
fn copy_then_remove(source: &Path, target: &Path) -> Result<(), String> {
    if let Err(error) = copy_to_new(source, target) {
        if error.kind() == ErrorKind::AlreadyExists {
            return Err(EXISTS.to_string());
        }
        let _ = fs::remove_file(target);
        return Err(format!("Could not move the file: {error}"));
    }
    fs::remove_file(source).map_err(|error| {
        let _ = fs::remove_file(target);
        format!("Could not move the file: {error}")
    })
}

/// Create one new folder at `path`; its parent must already exist. Returns `path` normalized.
pub fn create_directory(root: &str, path: &str) -> Result<String, String> {
    let entry = resolve_entry(root, path)?;
    validate_new_name(&entry.name)?;
    fs::create_dir(&entry.path).map_err(|error| match error.kind() {
        ErrorKind::AlreadyExists => EXISTS.to_string(),
        _ => format!("Could not create the folder: {error}"),
    })?;
    Ok(entry.relative)
}

/// Rename or move a file, within one workspace folder or between two of them. Never replaces an
/// existing entry. Returns the destination path normalized.
pub fn move_file(
    from_root: &str,
    from_path: &str,
    to_root: &str,
    to_path: &str,
) -> Result<String, String> {
    let source = resolve_entry(from_root, from_path)?;
    let target = resolve_entry(to_root, to_path)?;
    let metadata =
        fs::metadata(&source.path).map_err(|error| missing_or(error, "Could not read the file"))?;
    if !metadata.is_file() {
        return Err("Only files can be renamed or moved.".to_string());
    }
    if source.path == target.path {
        return Ok(target.relative);
    }
    validate_new_name(&target.name)?;
    ensure_kind_allowed(&source.path, &target.path)?;
    if fs::symlink_metadata(&target.path).is_ok() && !same_entry(&source.path, &target.path) {
        return Err(EXISTS.to_string());
    }
    if let Err(error) = fs::rename(&source.path, &target.path) {
        if source.root == target.root {
            return Err(format!("Could not move the file: {error}"));
        }
        copy_then_remove(&source.path, &target.path)?;
    }
    Ok(target.relative)
}

/// Permanently delete one file. Directories are refused.
pub fn delete_file(root: &str, path: &str) -> Result<(), String> {
    let entry = resolve_entry(root, path)?;
    let metadata = fs::symlink_metadata(&entry.path)
        .map_err(|error| missing_or(error, "Could not read the file"))?;
    if metadata.is_dir() {
        return Err("Only files can be deleted from the workspace tree.".to_string());
    }
    fs::remove_file(&entry.path).map_err(|error| format!("Could not delete the file: {error}"))
}
