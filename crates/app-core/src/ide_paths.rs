//! Path containment for the workbench file commands.
//!
//! The workbench talks to the backend with absolute paths, unlike the workspace tree which hands out
//! folder-relative ones. The backend therefore re-checks every path against the folders the user
//! pinned, so a crafted webview request cannot read or change files elsewhere. Symlinks are
//! resolved before the comparison, so a link planted inside a project cannot lead out of it.

use std::path::{Component, Path, PathBuf};

use crate::safepath::canonical;

/// Marks a path inside an archive: `<archive>!/<entry>`.
const ARCHIVE_SEPARATOR: &str = "!/";

/// What a command intends to do with the path, which decides whether it must already exist.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    /// The path exists: reading, renaming from, deleting, copying from.
    Existing,
    /// The path is about to be created: its parent must exist and be inside a root.
    New,
}

/// Extensions of key material: plain text, so neither a binary sniff nor a size cap would stop the
/// workbench from rendering a private key in the editor. The viewer refuses them through
/// `safepath::VIEW_DENY_EXTS`; a test keeps this subset inside that list.
pub const KEY_MATERIAL_EXTS: &[&str] = &[
    "pem", "key", "crt", "cer", "pfx", "p12", "ppk", "asc", "gpg", "jks", "keystore",
];

/// Whether the workbench editor must refuse to open `path` because it holds key material.
pub fn is_key_material(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            KEY_MATERIAL_EXTS
                .iter()
                .any(|denied| denied.eq_ignore_ascii_case(extension))
        })
}

/// Resolves `path` and returns it only if it is a pinned root or lies inside one.
///
/// `New` paths are resolved through their parent, because the path itself does not exist yet. A
/// trailing `..` is refused outright. An archive entry (`a.zip!/dir`) is checked through its archive
/// file and returned with the same entry suffix.
pub fn resolve_in_roots(roots: &[PathBuf], path: &Path, access: Access) -> Result<PathBuf, String> {
    let text = path.to_string_lossy();
    // Only a real archive *file* makes `!/` a separator. Anywhere else (`src!/..`) the text is an
    // ordinary path, and the OS normalises the `..` without needing `src!` to exist, so treating it
    // as an archive entry would let the suffix climb out of the root unchecked.
    if let Some((archive, entry)) = text.split_once(ARCHIVE_SEPARATOR) {
        if Path::new(archive).is_file() {
            if entry.split(['/', '\\']).any(|part| part == "..") {
                return Err(format!("{} is not a valid archive entry", path.display()));
            }
            let resolved = resolve_in_roots(roots, Path::new(archive), Access::Existing)?;
            return Ok(PathBuf::from(format!(
                "{}{ARCHIVE_SEPARATOR}{entry}",
                resolved.display()
            )));
        }
        return Err(format!("{} is not a valid path", path.display()));
    }
    let real_roots: Vec<PathBuf> = roots
        .iter()
        .filter_map(|root| canonical(root).ok())
        .collect();
    if real_roots.is_empty() {
        return Err("no workspace folder is open".to_string());
    }
    let resolved = match access {
        Access::Existing => canonical(path)?,
        Access::New => resolve_new(path)?,
    };
    if real_roots.iter().any(|root| resolved.starts_with(root)) {
        Ok(resolved)
    } else {
        Err(format!(
            "{} is outside the open workspace folders",
            path.display()
        ))
    }
}

fn resolve_new(path: &Path) -> Result<PathBuf, String> {
    if path.components().next_back() == Some(Component::ParentDir) {
        return Err(format!("{} is not a valid name", path.display()));
    }
    let name = path
        .file_name()
        .ok_or_else(|| format!("{} has no file name", path.display()))?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| format!("{} has no parent folder", path.display()))?;
    Ok(canonical(parent)?.join(name))
}

#[cfg(test)]
#[path = "ide_paths_tests.rs"]
mod tests;
