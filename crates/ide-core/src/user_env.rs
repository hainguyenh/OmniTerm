//! The environment Windows would give a program started now, for terminals opened after the
//! user changed a variable (installed a tool that extends `Path`, set `JAVA_HOME`, ...).
//!
//! A process inherits its environment once, when it starts: OmniTerm and its session daemon
//! keep the variables of the moment they were launched, and every shell they spawn would too,
//! until the app restarts (the daemon even outlives a restart). Explorer rebuilds the block from
//! the registry on `WM_SETTINGCHANGE`; [`refreshed_vars`] rebuilds it the same way
//! (`CreateEnvironmentBlock`) each time a terminal starts.

use std::ffi::OsString;

/// The variables to set on a new terminal so it sees the user's and the system's current
/// environment: every variable of a freshly built environment block, which overrides the
/// inherited value. `Path` keeps the inherited entries the fresh one lacks after its own, so
/// directories added by whatever launched OmniTerm (a shell with a version manager) stay
/// usable. Variables the registry doesn't define are not returned, so inherited ones survive.
/// Empty outside Windows or when the block can't be built.
pub fn refreshed_vars() -> Vec<(OsString, OsString)> {
    #[cfg(windows)]
    {
        windows::environment_block()
            .map(|fresh| overlay(fresh, |key| std::env::var_os(key)))
            .unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// `fresh` with `Path` merged with the inherited value [`inherited`] reports.
#[cfg(any(windows, test))]
fn overlay(
    fresh: Vec<(OsString, OsString)>,
    inherited: impl Fn(&str) -> Option<OsString>,
) -> Vec<(OsString, OsString)> {
    fresh
        .into_iter()
        .map(|(key, value)| {
            if !key.eq_ignore_ascii_case("path") {
                return (key, value);
            }
            let merged = match (value.to_str(), inherited("Path").as_deref().and_then(|v| v.to_str())) {
                (Some(fresh), Some(old)) => OsString::from(merge_path(fresh, old)),
                _ => value,
            };
            (key, merged)
        })
        .collect()
}

/// `fresh` followed by the entries of `inherited` it doesn't contain (case-insensitive,
/// ignoring a trailing separator, as Windows compares directories).
#[cfg(any(windows, test))]
fn merge_path(fresh: &str, inherited: &str) -> String {
    let normalize = |entry: &str| entry.trim_end_matches(['\\', '/']).to_ascii_lowercase();
    let mut seen: Vec<String> = Vec::new();
    let mut entries: Vec<&str> = Vec::new();
    for entry in fresh.split(';').chain(inherited.split(';')) {
        let key = normalize(entry);
        if key.is_empty() || seen.contains(&key) {
            continue;
        }
        seen.push(key);
        entries.push(entry);
    }
    entries.join(";")
}

/// The `NAME=value` entries of an environment block (UTF-16, each entry NUL-terminated, the
/// block ending with an empty entry). Skips the hidden per-drive entries (`=C:=C:\dir`) and
/// anything without a name.
#[cfg(any(windows, test))]
fn parse_block(block: &[u16]) -> Vec<(&[u16], &[u16])> {
    const EQUALS: u16 = b'=' as u16;
    block
        .split(|&unit| unit == 0)
        .take_while(|entry| !entry.is_empty())
        .filter_map(|entry| {
            let at = entry.iter().position(|&unit| unit == EQUALS)?;
            (at > 0).then(|| (&entry[..at], &entry[at + 1..]))
        })
        .collect()
}

#[cfg(windows)]
mod windows {
    use std::ffi::{c_void, OsString};
    use std::os::windows::ffi::OsStringExt;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{TOKEN_DUPLICATE, TOKEN_IMPERSONATE, TOKEN_QUERY};
    use windows_sys::Win32::System::Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    /// The environment block of this process's user, built from the registry without
    /// inheriting this process's variables. `None` when Windows refuses.
    pub(super) fn environment_block() -> Option<Vec<(OsString, OsString)>> {
        let mut token: HANDLE = std::ptr::null_mut();
        // SAFETY: `GetCurrentProcess` returns a pseudo handle that needs no closing; `token`
        // is a valid out pointer and is closed below once the block is built.
        let opened =
            unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_IMPERSONATE, &mut token) };
        if opened == 0 {
            return None;
        }
        let mut block: *mut c_void = std::ptr::null_mut();
        // SAFETY: `token` is an open token handle with the access the call needs; `block` is a
        // valid out pointer. `0` asks for the user's variables only, not this process's.
        let created = unsafe { CreateEnvironmentBlock(&mut block, token, 0) };
        // SAFETY: `token` was opened above and is not used after this.
        unsafe { CloseHandle(token) };
        if created == 0 || block.is_null() {
            return None;
        }
        // SAFETY: a block from `CreateEnvironmentBlock` is a sequence of NUL-terminated UTF-16
        // strings ending with an empty one, so scanning for two NULs in a row stays inside it.
        let units = unsafe { block_units(block.cast::<u16>()) };
        let vars = super::parse_block(units)
            .into_iter()
            .map(|(key, value)| (OsString::from_wide(key), OsString::from_wide(value)))
            .collect();
        // SAFETY: `block` came from `CreateEnvironmentBlock` and `units` is no longer used.
        unsafe { DestroyEnvironmentBlock(block) };
        Some(vars)
    }

    /// The block's units up to and including its terminating empty entry.
    unsafe fn block_units<'a>(start: *const u16) -> &'a [u16] {
        let mut len = 0;
        // SAFETY: the caller guarantees the block ends with two consecutive NULs.
        while unsafe { *start.add(len) != 0 || *start.add(len + 1) != 0 } {
            len += 1;
        }
        // SAFETY: the `len + 2` units read above are part of the block.
        unsafe { std::slice::from_raw_parts(start, len + 2) }
    }
}

#[cfg(test)]
#[path = "user_env_tests.rs"]
mod tests;
