//! Open and save for the built-in text editor.
//!
//! Both directions use the *view* gate from `safepath` — containment with symlinks resolved, the
//! built-in deny-list (binaries, archives, key material) and the user's excluded extensions — so any
//! file the editor may show it may also save. Saving adds what reading does not need:
//!
//!   * **Conflict detection.** The editor sends back the mtime and size it loaded; a file that changed
//!     or vanished on disk since is reported as a conflict for the user to resolve, never silently
//!     overwritten.
//!   * **Binary refusal.** An existing file whose head holds a NUL is not replaced with text.
//!   * **Atomic replace.** The bytes go to a temp file in the same directory that is then renamed over
//!     the original, so a crash mid-save leaves the old file rather than a truncated one.
//!
//! A UTF-8 BOM is stripped on open and reported as a flag, then written back on save when the flag is
//! still set: the editor never sees U+FEFF, and a PowerShell script keeps the BOM it depends on.

use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

use app_protocol::text_file::{
    ConflictReason, TextEol, TextFileContent, TextFileSaveOutcome, TextFileSaveRequest,
};

use crate::safepath;

#[cfg(test)]
#[path = "text_file_tests.rs"]
mod tests;

const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";

/// Disambiguates temp files when two saves of one file overlap within a process.
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Line statistics gathered in one pass over the text.
#[derive(Debug, Default, PartialEq, Eq)]
struct TextStats {
    line_count: usize,
    max_line_len: usize,
    crlf: usize,
    lf: usize,
    cr: usize,
}

/// Count lines, the longest line in characters, and each kind of line ending.
///
/// Character length counts UTF-8 lead bytes rather than decoding, which keeps this a byte loop over
/// a file that can be tens of megabytes.
fn measure(text: &str) -> TextStats {
    let bytes = text.as_bytes();
    let mut stats = TextStats {
        line_count: 1,
        ..TextStats::default()
    };
    let mut line_len = 0usize;
    let mut index = 0usize;
    while index < bytes.len() {
        let byte = bytes[index];
        let line_ended = match byte {
            b'\r' if bytes.get(index + 1) == Some(&b'\n') => {
                stats.crlf += 1;
                index += 1;
                true
            }
            b'\r' => {
                stats.cr += 1;
                true
            }
            b'\n' => {
                stats.lf += 1;
                true
            }
            _ => {
                if byte & 0xC0 != 0x80 {
                    line_len += 1;
                }
                false
            }
        };
        if line_ended {
            stats.max_line_len = stats.max_line_len.max(line_len);
            line_len = 0;
            stats.line_count += 1;
        }
        index += 1;
    }
    stats.max_line_len = stats.max_line_len.max(line_len);
    stats
}

/// The majority line ending, or the platform's own for a file with none (a single line, or empty)
/// so lines the user adds match what other editors on this machine would write.
fn dominant_eol(stats: &TextStats) -> TextEol {
    let unix_like = stats.lf + stats.cr;
    if stats.crlf > unix_like || (stats.crlf == 0 && unix_like == 0 && cfg!(windows)) {
        TextEol::Crlf
    } else {
        TextEol::Lf
    }
}

fn is_mixed(stats: &TextStats) -> bool {
    [stats.crlf, stats.lf, stats.cr]
        .iter()
        .filter(|count| **count > 0)
        .count()
        > 1
}

/// Milliseconds since the Unix epoch, or 0 when the platform or filesystem reports no mtime.
fn mtime_ms(metadata: &Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// Open an in-workspace file for the editor, bounded by `max_bytes`.
pub fn open_text_file(
    root: &str,
    path: &str,
    max_bytes: u64,
    excluded: &[String],
) -> Result<TextFileContent, String> {
    let real = safepath::safe_viewable_path_excluding(root, path, excluded)?;
    let metadata = fs::metadata(&real).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("only files can be opened in the editor".to_string());
    }
    let size = metadata.len();
    if size > max_bytes {
        return Err(safepath::open_limit_error(size, max_bytes));
    }
    let mut bytes = fs::read(&real).map_err(|e| e.to_string())?;
    let has_bom = bytes.starts_with(UTF8_BOM);
    if has_bom {
        bytes.drain(..UTF8_BOM.len());
    }
    let content = safepath::sniff_text(bytes)?;
    let stats = measure(&content);
    Ok(TextFileContent {
        size,
        mtime_ms: mtime_ms(&metadata),
        line_count: stats.line_count,
        max_line_len: stats.max_line_len,
        eol: dominant_eol(&stats),
        mixed_eol: is_mixed(&stats),
        has_bom,
        read_only: metadata.permissions().readonly(),
        content,
    })
}

/// Resolve where a file that no longer exists would be recreated.
///
/// `safe_viewable_path_excluding` canonicalizes the target, which fails for a missing file, so the
/// containment check moves to the parent directory: it must resolve inside (or be) the workspace
/// root, and the file name must be a single plain component of a viewable kind.
fn missing_target(root: &str, path: &str, excluded: &[String]) -> Result<PathBuf, String> {
    let real_root = safepath::canonical(Path::new(root))?;
    let candidate = Path::new(path);
    let joined = if candidate.is_relative() {
        real_root.join(candidate)
    } else {
        candidate.to_path_buf()
    };
    let name = match joined.components().next_back() {
        Some(Component::Normal(name)) => name.to_os_string(),
        _ => return Err("file is outside its workspace".to_string()),
    };
    let parent = joined
        .parent()
        .ok_or_else(|| "file is outside its workspace".to_string())?;
    let real_parent = safepath::canonical(parent)?;
    if real_parent != real_root && !safepath::is_inside(&real_root, &real_parent) {
        return Err("file is outside its workspace".to_string());
    }
    let ext = Path::new(&name)
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !safepath::is_viewable_kind_excluding(&ext, excluded) {
        return Err("this file type cannot be viewed as text".to_string());
    }
    Ok(real_parent.join(name))
}

/// True if the first `SNIFF_BYTES` of `path` contain a NUL — the same test the open path applies.
fn head_is_binary(path: &Path) -> io::Result<bool> {
    let mut head = Vec::with_capacity(safepath::SNIFF_BYTES);
    File::open(path)?
        .take(safepath::SNIFF_BYTES as u64)
        .read_to_end(&mut head)?;
    Ok(head.contains(&0))
}

fn write_contents(file: &mut File, bom: bool, content: &str) -> io::Result<()> {
    if bom {
        file.write_all(UTF8_BOM)?;
    }
    file.write_all(content.as_bytes())?;
    file.sync_all()
}

/// Replace `target` with the new contents through a temp file renamed over it.
///
/// The temp file is dot-prefixed so the workspace tree's default view does not flash it. If the
/// rename itself fails — on Windows a scanner or indexer holding the file without delete sharing is
/// enough — the save falls back to rewriting the file in place rather than failing outright.
fn write_atomic(target: &Path, bom: bool, content: &str) -> Result<(), String> {
    let dir = target
        .parent()
        .ok_or_else(|| "file has no parent directory".to_string())?;
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let temp = dir.join(format!(
        ".{name}.{}.{}.omniterm-tmp",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let staged = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .and_then(|mut file| write_contents(&mut file, bom, content));
    if let Err(e) = staged {
        let _ = fs::remove_file(&temp);
        return Err(format!("Could not save the file: {e}"));
    }
    // Carry the original's permissions over (the executable bit on a `.sh`, for one) — the rename
    // replaces the file, and with it whatever mode the temp file was created with.
    if let Ok(existing) = fs::metadata(target) {
        let _ = fs::set_permissions(&temp, existing.permissions());
    }
    if let Err(rename_error) = fs::rename(&temp, target) {
        let _ = fs::remove_file(&temp);
        log::warn!("atomic save rename failed ({rename_error}); rewriting in place");
        return File::create(target)
            .and_then(|mut file| write_contents(&mut file, bom, content))
            .map_err(|e| format!("Could not save the file: {e}"));
    }
    Ok(())
}

/// Save editor contents to an in-workspace file, bounded by `max_bytes` (BOM included).
pub fn save_text_file(
    root: &str,
    path: &str,
    request: &TextFileSaveRequest,
    max_bytes: u64,
    excluded: &[String],
) -> Result<TextFileSaveOutcome, String> {
    let total = request.content.len() as u64 + if request.bom { 3 } else { 0 };
    if total > max_bytes {
        return Err(format!(
            "This content is {} and the save limit is {}.",
            safepath::human_bytes(total),
            safepath::human_bytes(max_bytes)
        ));
    }

    let candidate = Path::new(root).join(path);
    let target = if fs::metadata(&candidate).is_ok() {
        let real = safepath::safe_viewable_path_excluding(root, path, excluded)?;
        let metadata = fs::metadata(&real).map_err(|e| e.to_string())?;
        if !metadata.is_file() {
            return Err("only files can be saved from the editor".to_string());
        }
        if !request.force {
            let disk_mtime = mtime_ms(&metadata);
            let modified = request.expected_mtime_ms.is_some_and(|m| m != disk_mtime)
                || request.expected_size.is_some_and(|s| s != metadata.len());
            if modified {
                return Ok(TextFileSaveOutcome::Conflict {
                    reason: ConflictReason::Modified,
                    disk_mtime_ms: Some(disk_mtime),
                });
            }
        }
        if metadata.permissions().readonly() {
            return Err("This file is read-only on disk.".to_string());
        }
        if head_is_binary(&real).map_err(|e| e.to_string())? {
            return Err("this looks like a binary file, not text".to_string());
        }
        real
    } else {
        let target = missing_target(root, path, excluded)?;
        if !request.force {
            return Ok(TextFileSaveOutcome::Conflict {
                reason: ConflictReason::Deleted,
                disk_mtime_ms: None,
            });
        }
        target
    };

    write_atomic(&target, request.bom, &request.content)?;
    let metadata = fs::metadata(&target).map_err(|e| e.to_string())?;
    Ok(TextFileSaveOutcome::Saved {
        size: metadata.len(),
        mtime_ms: mtime_ms(&metadata),
    })
}
