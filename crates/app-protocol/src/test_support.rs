//! Fixtures shared by the crate's `#[cfg(test)]` modules.
//!
//! The only shared state here is the process environment: `is_on_path` reads `PATH`, and one test
//! rewrites it. The Rust test runner interleaves threads, so those tests must be serialized.

use std::sync::{Mutex, MutexGuard};

/// Serializes every test that touches state the process shares.
static GLOBAL: Mutex<()> = Mutex::new(());

/// Take the global test lock, ignoring poisoning.
///
/// A failed assertion panics, which poisons the mutex; `unwrap()` would then turn one real failure
/// into a cascade of `PoisonError`s in every test that ran after it, burying the actual cause. There
/// is no invariant to protect here — each test restores what it changed.
pub(crate) fn lock() -> MutexGuard<'static, ()> {
    GLOBAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}