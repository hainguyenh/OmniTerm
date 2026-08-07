//! Fixtures shared by the crate's `#[cfg(test)]` modules.
//!
//! The only shared state here is the process environment: `is_on_path` reads `PATH`, and one test
//! rewrites it. The Rust test runner interleaves threads, so those tests must be serialized.
//!
//! That one test is `#[cfg(not(target_os = "windows"))]` — rewriting `PATH` under a temporary
//! directory of shell scripts only means anything where `is_executable` consults the mode bits. So
//! the lock has no caller on Windows, and compiling it there is two `dead_code` warnings against a
//! `-D warnings` build. It is gated to match its only consumer rather than silenced with an
//! `allow`, which would also hide a genuinely unused fixture added later.

#[cfg(not(target_os = "windows"))]
use std::sync::{Mutex, MutexGuard};

/// Serializes every test that touches state the process shares.
#[cfg(not(target_os = "windows"))]
static GLOBAL: Mutex<()> = Mutex::new(());

/// Take the global test lock, ignoring poisoning.
///
/// A failed assertion panics, which poisons the mutex; `unwrap()` would then turn one real failure
/// into a cascade of `PoisonError`s in every test that ran after it, burying the actual cause. There
/// is no invariant to protect here — each test restores what it changed.
#[cfg(not(target_os = "windows"))]
pub(crate) fn lock() -> MutexGuard<'static, ()> {
    GLOBAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}