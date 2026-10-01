//! The app's attachment folder: images and files pasted or dropped into an AI agent pane.
//!
//! An agent attaches a file by path, so every paste/drop is written to disk first. They used to go to
//! the OS temp directory, where the user could neither find nor review them and nothing ever cleaned
//! them up. They now live in one folder the app owns, which Settings can summarize and clear.
//!
//! The renderer only ever supplies a *name hint* and bytes; the folder, the final file name and the
//! extension are decided here. A hint is reduced to a single safe file-name component, so no value
//! from the webview can steer a write outside the folder.

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[cfg(test)]
#[path = "attachments_tests.rs"]
mod tests;

/// Largest single attachment accepted. Agents reject far smaller files; this only bounds the write.
pub const MAX_ATTACHMENT_BYTES: usize = 50 * 1024 * 1024;

/// Pasted images from builds that wrote into the OS temp directory (`omniterm-paste-<ms>.png`).
const LEGACY_PASTE_PREFIX: &str = "omniterm-paste-";

const MAX_STEM_CHARS: usize = 80;
const MAX_EXTENSION_CHARS: usize = 10;
const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const RESERVED_WINDOWS_NAMES: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AttachmentKind {
    Image,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified_ms: u64,
    pub kind: AttachmentKind,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearReport {
    pub removed: usize,
    pub bytes: u64,
    pub failed: usize,
}

/// Split a sanitized name into its stem and a lowercase alphanumeric extension (possibly empty).
fn split_extension(name: &str) -> (&str, String) {
    match name.rsplit_once('.') {
        Some((stem, ext))
            if !stem.is_empty()
                && !ext.is_empty()
                && ext.chars().count() <= MAX_EXTENSION_CHARS
                && ext.chars().all(|c| c.is_ascii_alphanumeric()) =>
        {
            (stem, ext.to_ascii_lowercase())
        }
        _ => (name, String::new()),
    }
}

/// Reduce a renderer-supplied name to one safe file-name component: the last path segment, without
/// control or Windows-reserved characters, leading dots, trailing dots/spaces or a reserved device
/// name, capped in length. Never empty.
pub fn sanitize_file_name(hint: &str) -> String {
    let last = hint.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        .collect();
    let trimmed = cleaned
        .trim_start_matches(['.', ' '])
        .trim_end_matches(['.', ' ']);
    let (stem, ext) = split_extension(trimmed);
    let mut stem: String = stem.chars().take(MAX_STEM_CHARS).collect();
    stem = stem.trim_end_matches(['.', ' ']).to_string();
    if stem.is_empty() {
        stem = "attachment".to_string();
    }
    let device = stem.split('.').next().unwrap_or("").to_ascii_lowercase();
    if RESERVED_WINDOWS_NAMES.contains(&device.as_str()) {
        stem.insert(0, '_');
    }
    if ext.is_empty() {
        stem
    } else {
        format!("{stem}.{ext}")
    }
}

fn kind_of(name: &str) -> AttachmentKind {
    let (_, ext) = split_extension(name);
    if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        AttachmentKind::Image
    } else {
        AttachmentKind::File
    }
}

fn modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn info_for(path: &Path, metadata: &fs::Metadata) -> Option<AttachmentInfo> {
    let name = path.file_name()?.to_str()?.to_string();
    Some(AttachmentInfo {
        kind: kind_of(&name),
        path: path.to_string_lossy().into_owned(),
        size: metadata.len(),
        modified_ms: modified_ms(metadata),
        name,
    })
}

/// Create a new, empty file in `dir` named `<stem>-<stamp>.<ext>` from the sanitized hint, with a
/// counter on collision. `create_new` guarantees an existing file is never opened or overwritten.
fn reserve_file(dir: &Path, name_hint: &str, stamp_ms: u128) -> io::Result<(fs::File, PathBuf)> {
    fs::create_dir_all(dir)?;
    let safe = sanitize_file_name(name_hint);
    let (stem, ext) = split_extension(&safe);
    for attempt in 0..1000u32 {
        let base = if attempt == 0 {
            format!("{stem}-{stamp_ms}")
        } else {
            format!("{stem}-{stamp_ms}-{attempt}")
        };
        let file_name = if ext.is_empty() {
            base
        } else {
            format!("{base}.{ext}")
        };
        let path = dir.join(file_name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((file, path)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not find a free attachment name",
    ))
}

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn finish(path: &Path) -> io::Result<AttachmentInfo> {
    let metadata = fs::metadata(path)?;
    info_for(path, &metadata)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "attachment name is not UTF-8"))
}

/// Write `bytes` into `dir` as a new attachment named after `name_hint` (see [`reserve_file`]).
pub fn save_attachment(
    dir: &Path,
    name_hint: &str,
    bytes: &[u8],
    stamp_ms: u128,
) -> io::Result<AttachmentInfo> {
    if bytes.is_empty() {
        return Err(invalid("attachment is empty"));
    }
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(invalid("attachment is larger than 50 MB"));
    }
    let (mut file, path) = reserve_file(dir, name_hint, stamp_ms)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    finish(&path)
}

/// Copy an existing file (one the user copied in Explorer) into `dir` as a new attachment. Only a
/// regular, non-empty file within [`MAX_ATTACHMENT_BYTES`] is accepted; folders are refused.
pub fn import_attachment(dir: &Path, source: &Path, stamp_ms: u128) -> io::Result<AttachmentInfo> {
    let metadata = fs::metadata(source)?;
    if !metadata.is_file() {
        return Err(invalid("only files can be attached"));
    }
    if metadata.len() == 0 {
        return Err(invalid("attachment is empty"));
    }
    if metadata.len() > MAX_ATTACHMENT_BYTES as u64 {
        return Err(invalid("attachment is larger than 50 MB"));
    }
    let name = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut input = fs::File::open(source)?;
    let (mut file, path) = reserve_file(dir, &name, stamp_ms)?;
    io::copy(&mut input, &mut file)?;
    file.sync_all()?;
    finish(&path)
}

/// The paths in a Windows `DROPFILES` block (the `CF_HDROP` clipboard format Explorer's Copy puts
/// on the clipboard): a 20-byte header whose first `u32` is the offset of a list of NUL-terminated
/// names ending in an empty one, UTF-16 when the `fWide` field (offset 16) is non-zero. Anything
/// malformed yields the names read so far.
pub fn parse_drop_files(block: &[u8]) -> Vec<PathBuf> {
    let read_u32 = |at: usize| -> Option<u32> {
        block
            .get(at..at + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    };
    let (Some(offset), Some(wide)) = (read_u32(0), read_u32(16)) else {
        return Vec::new();
    };
    let Some(list) = usize::try_from(offset).ok().and_then(|at| block.get(at..)) else {
        return Vec::new();
    };
    let names: Vec<String> = if wide != 0 {
        let units: Vec<u16> = list
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        units
            .split(|unit| *unit == 0)
            .take_while(|name| !name.is_empty())
            .map(String::from_utf16_lossy)
            .collect()
    } else {
        list.split(|byte| *byte == 0)
            .take_while(|name| !name.is_empty())
            .map(|name| String::from_utf8_lossy(name).into_owned())
            .collect()
    };
    names.into_iter().map(PathBuf::from).collect()
}

/// Reduce session id to a safe subdirectory name without control characters or separators.
pub fn sanitize_session_dir(session_id: &str) -> String {
    let cleaned: String = session_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    if cleaned.is_empty() {
        "common".to_string()
    } else {
        cleaned
    }
}

fn collect_attachments(dir: &Path, out: &mut Vec<AttachmentInfo>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if let Ok(metadata) = entry.metadata() {
            if metadata.is_file() {
                if let Some(info) = info_for(&entry.path(), &metadata) {
                    out.push(info);
                }
            } else if metadata.is_dir() {
                collect_attachments(&entry.path(), out);
            }
        }
    }
}

/// Every regular file in `dir`, newest first. A missing folder is an empty list.
pub fn list_attachments(dir: &Path) -> Vec<AttachmentInfo> {
    let mut infos = Vec::new();
    collect_attachments(dir, &mut infos);
    infos.sort_by(|a, b| {
        b.modified_ms
            .cmp(&a.modified_ms)
            .then_with(|| a.name.cmp(&b.name))
    });
    infos
}

fn is_legacy_paste(name: &str) -> bool {
    name.starts_with(LEGACY_PASTE_PREFIX) && name.ends_with(".png")
}

fn remove_files(paths: impl Iterator<Item = (PathBuf, u64)>, report: &mut ClearReport) {
    for (path, size) in paths {
        match fs::remove_file(&path) {
            Ok(()) => {
                report.removed += 1;
                report.bytes += size;
            }
            Err(_) => report.failed += 1,
        }
    }
}

/// The legacy `omniterm-paste-*.png` files in `temp_dir` — pasted images from before the folder.
pub fn legacy_pastes(temp_dir: &Path) -> Vec<AttachmentInfo> {
    let Ok(entries) = fs::read_dir(temp_dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            let info = info_for(&entry.path(), &metadata)?;
            (metadata.is_file() && is_legacy_paste(&info.name)).then_some(info)
        })
        .collect()
}

/// Delete every file in `dir`, plus the legacy pasted images in `temp_dir` when given. A file that
/// is still open elsewhere is counted as failed and left in place; nothing else is touched.
pub fn clear_attachments(dir: &Path, temp_dir: Option<&Path>) -> ClearReport {
    let mut report = ClearReport::default();
    let current = list_attachments(dir)
        .into_iter()
        .map(|info| (PathBuf::from(info.path), info.size));
    remove_files(current, &mut report);
    if let Some(temp_dir) = temp_dir {
        let legacy = legacy_pastes(temp_dir)
            .into_iter()
            .map(|info| (PathBuf::from(info.path), info.size));
        remove_files(legacy, &mut report);
    }
    report
}

/// Decode a `%XX`-escaped UTF-8 string (the encoding `encodeURIComponent` produces), for names
/// carried in an IPC header. `None` for a malformed escape or invalid UTF-8.
pub fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = value.get(index + 1..index + 3)?;
            if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                return None;
            }
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}
