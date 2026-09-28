//! Reads the file list Explorer's Copy puts on the clipboard (`CF_HDROP`). The WebView cannot see
//! it: a paste of copied files carries no text and no image, so without this Ctrl+V did nothing.

use app_core::attachments::parse_drop_files;
use std::path::PathBuf;
use std::thread::sleep;
use std::time::Duration;
use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND};
use windows::Win32::System::DataExchange::{
    CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
};
use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

/// `CF_HDROP` (winuser.h); a stable Win32 constant, spelled out rather than pulling in the Ole feature.
const CF_HDROP: u32 = 15;

/// Closes the clipboard on every exit path once it has been opened.
struct OpenedClipboard;

impl Drop for OpenedClipboard {
    fn drop(&mut self) {
        // SAFETY: only constructed after a successful OpenClipboard on this thread.
        let _ = unsafe { CloseClipboard() };
    }
}

fn open() -> Option<OpenedClipboard> {
    // Another app may hold the clipboard for a moment (clipboard managers do); retry briefly.
    for _ in 0..5 {
        // SAFETY: plain Win32 call; a null owner window associates the clipboard with this task.
        if unsafe { OpenClipboard(HWND::default()) }.is_ok() {
            return Some(OpenedClipboard);
        }
        sleep(Duration::from_millis(20));
    }
    None
}

/// The copied files' paths, or `None` when the clipboard holds none or cannot be read.
pub fn read() -> Option<Vec<PathBuf>> {
    // SAFETY: querying format availability needs no open clipboard.
    unsafe { IsClipboardFormatAvailable(CF_HDROP) }.ok()?;
    let _guard = open()?;
    // SAFETY: the clipboard is open; the handle stays valid until it is closed (guard drop).
    let handle: HANDLE = unsafe { GetClipboardData(CF_HDROP) }.ok()?;
    let global = HGLOBAL(handle.0);
    // SAFETY: CF_HDROP data is an HGLOBAL; its size bounds the slice we read from the lock.
    let size = unsafe { GlobalSize(global) };
    let data = unsafe { GlobalLock(global) };
    if data.is_null() || size == 0 {
        return None;
    }
    // SAFETY: `data` points at `size` readable bytes while locked; copied out before unlocking.
    let block = unsafe { std::slice::from_raw_parts(data.cast::<u8>(), size) }.to_vec();
    // SAFETY: balances the GlobalLock above.
    let _ = unsafe { GlobalUnlock(global) };
    Some(parse_drop_files(&block))
}
