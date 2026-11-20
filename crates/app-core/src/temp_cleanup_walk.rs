//! The walks of the temp clean-up: sizing an entry and removing it, each in a single pass. Sizes
//! come from the directory listing itself (on Windows the listing already carries every file's
//! size, so no file is opened or `stat`ed again), links are never followed, and a removal frees
//! what it can and reports the first refusal.

use std::fs;
use std::io;
use std::path::Path;

use crate::parallel::Progress;

/// Files and bytes under `path` (a file counts as one), links not followed; unreadable parts
/// count as nothing. Stops early once cancelled.
pub(super) fn measure(path: &Path, is_dir: bool, len: u64, progress: &Progress<'_>) -> (u64, u64) {
    if !is_dir {
        return (1, len);
    }
    let (mut files, mut bytes) = (0, 0);
    let mut stack = vec![path.to_path_buf()];
    while let Some(current) = stack.pop() {
        if progress.cancelled() {
            break;
        }
        let Ok(children) = fs::read_dir(&current) else {
            continue;
        };
        for child in children.flatten() {
            let Ok(kind) = child.file_type() else {
                continue;
            };
            if kind.is_dir() {
                stack.push(child.path());
            } else {
                files += 1;
                bytes += child.metadata().map_or(0, |meta| meta.len());
            }
        }
    }
    (files, bytes)
}

/// Clears the read-only attribute of `path` (Windows refuses to delete a read-only entry).
fn clear_read_only(path: &Path) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return;
    };
    let mut permissions = meta.permissions();
    if permissions.readonly() {
        // The Windows read-only attribute; the entry is deleted right after.
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        let _ = fs::set_permissions(path, permissions);
    }
}

/// Runs `remove` once more after clearing the read-only attribute when it is refused: of the
/// entry, and of `parent` (a folder inside the entry being removed, never the temp folder itself).
fn forced(
    path: &Path,
    parent: Option<&Path>,
    remove: fn(&Path) -> io::Result<()>,
) -> io::Result<()> {
    match remove(path) {
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            clear_read_only(path);
            if let Some(parent) = parent {
                clear_read_only(parent);
            }
            remove(path)
        }
        other => other,
    }
}

/// Removes a link itself, never its target: a file link with `remove_file`, a directory link or
/// junction (Windows) with `remove_dir`.
fn remove_link(path: &Path, parent: Option<&Path>) -> io::Result<()> {
    forced(path, parent, remove_file).or_else(|_| forced(path, parent, remove_dir))
}

/// What one removal freed, and the first error that kept part of it.
pub(super) struct Removal {
    pub freed: u64,
    pub error: Option<io::Error>,
}

/// Removes `path` and everything below it in one pass, counting the bytes of the files it removes.
/// A part that cannot be removed is left and the walk goes on; links are removed, not followed.
pub(super) fn remove_tree(path: &Path, progress: &Progress<'_>) -> Removal {
    let mut removal = Removal {
        freed: 0,
        error: None,
    };
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => removal.error = remove_link(path, None).err(),
        Ok(meta) if meta.is_dir() => remove_dir_contents(path, progress, &mut removal),
        Ok(meta) => match forced(path, None, remove_file) {
            Ok(()) => removal.freed = meta.len(),
            Err(error) => removal.error = Some(error),
        },
        Err(error) => removal.error = Some(error),
    }
    removal
}

fn keep_first(removal: &mut Removal, error: io::Error) {
    if removal.error.is_none() {
        removal.error = Some(error);
    }
}

fn remove_dir_contents(dir: &Path, progress: &Progress<'_>, removal: &mut Removal) {
    match fs::read_dir(dir) {
        Ok(children) => {
            for child in children.flatten() {
                if progress.cancelled() {
                    keep_first(
                        removal,
                        io::Error::new(io::ErrorKind::Interrupted, "Cancelled"),
                    );
                    return;
                }
                let path = child.path();
                let Ok(kind) = child.file_type() else {
                    continue;
                };
                if kind.is_symlink() {
                    if let Err(error) = remove_link(&path, Some(dir)) {
                        keep_first(removal, error);
                    }
                } else if kind.is_dir() {
                    remove_dir_contents(&path, progress, removal);
                } else {
                    let len = child.metadata().map_or(0, |meta| meta.len());
                    match forced(&path, Some(dir), remove_file) {
                        Ok(()) => removal.freed += len,
                        Err(error) => keep_first(removal, error),
                    }
                }
            }
        }
        Err(error) => {
            keep_first(removal, error);
            return;
        }
    }
    if let Err(error) = forced(dir, None, remove_dir) {
        keep_first(removal, error);
    }
}

fn remove_file(path: &Path) -> io::Result<()> {
    fs::remove_file(path)
}

fn remove_dir(path: &Path) -> io::Result<()> {
    fs::remove_dir(path)
}
