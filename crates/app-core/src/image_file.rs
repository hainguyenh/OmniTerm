//! Read-only image bytes for the editor's image viewer.
//!
//! A fourth gate beside `safepath`'s run, write and view gates, and the narrowest of them: an
//! allow-list of raster formats the webview can decode, read whole and never written. It shares the
//! same containment (symlinks resolved, strict descendant of the workspace folder) and honours the
//! user's excluded extensions, so it cannot reach anything the text viewer could not — it only lets
//! the viewer show image files that `VIEW_DENY_EXTS` keeps out of the *text* editor.
//!
//! `.svg` is absent on purpose: it is text, opened by the text editor and previewed from its source.
//! `.tif`/`.tiff` are absent because the webview cannot decode them.

use std::fs;

use crate::safepath;

#[cfg(test)]
#[path = "image_file_tests.rs"]
mod tests;

/// Extensions the image viewer will read.
pub const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"];

/// Fixed ceiling on an image read, independent of the text editor's configurable cap.
///
/// Image bytes are handed to the webview as one buffer and decoded there, so the text cap (1 MiB by
/// default, sized for scripts) would refuse ordinary screenshots. 25 MiB matches the text ceiling.
pub const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

/// Read an in-workspace image file, bounded by `MAX_IMAGE_BYTES`.
pub fn read_image_file(root: &str, path: &str, excluded: &[String]) -> Result<Vec<u8>, String> {
    let real = safepath::contained_path(root, path)?;
    let ext = safepath::ext_of(&real);
    if !IMAGE_EXTS.contains(&ext.as_str()) || excluded.iter().any(|e| e.eq_ignore_ascii_case(&ext))
    {
        return Err("this file type cannot be shown as an image".to_string());
    }
    let metadata = fs::metadata(&real).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("only files can be opened in the image viewer".to_string());
    }
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err(format!(
            "This image is {} and the viewer limit is {}.",
            safepath::human_bytes(metadata.len()),
            safepath::human_bytes(MAX_IMAGE_BYTES)
        ));
    }
    fs::read(&real).map_err(|e| e.to_string())
}
