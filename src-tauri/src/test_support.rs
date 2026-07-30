//! Fixtures shared by the crate's `#[cfg(test)]` modules.
//!
//! Both items here exist because `tauri::test`'s mock app is less isolated than it looks: every mock
//! app in a test binary resolves the same app-data path, and several of these tests reach for
//! process-global env vars on top of that.

use std::sync::{Mutex, MutexGuard};
use tauri::test::MockRuntime;

/// Serializes every test that touches state the process shares.
///
/// Two kinds of global sit behind this one lock, and separating them would not buy anything: the env
/// vars these tests set (`PATH`, `OMNITERM_DEV_PLUGIN`) belong to the whole process, and `mock_app`
/// hands every fixture the same app-data directory. Test-runner threads interleave otherwise, and one
/// fixture's cleanup deletes another's files mid-test.
static GLOBAL: Mutex<()> = Mutex::new(());

/// Take the global test lock, ignoring poisoning.
///
/// A failed assertion panics, which poisons the mutex; `unwrap()` would then turn one real failure
/// into a cascade of `PoisonError`s in every test that ran after it, burying the actual cause. There
/// is no invariant to protect here — the guarded state is the environment, and each test restores
/// what it changed.
pub(crate) fn lock() -> MutexGuard<'static, ()> {
    GLOBAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A mock app whose per-app directories point somewhere this test binary owns.
///
/// `tauri::test::mock_app()` leaves the bundle identifier empty, and Tauri resolves
/// `app_data_dir()`/`app_cache_dir()` as `dirs::data_dir().join(identifier)` — so with no identifier
/// they are bare `%APPDATA%` and `%LOCALAPPDATA%`. Fixtures were writing `connections.json`,
/// `workspaces.json` and `settings.json` into the roaming profile root and then calling
/// `remove_dir_all` on it to clean up after themselves. That delete cannot succeed: it fails part-way
/// on the profile's in-use subdirectories, so the litter survived and the next run read it back as
/// real user data — `workspaces.json` accumulated a workspace per run until the "one workspace"
/// assertions failed. Setting an identifier puts all of it under one disposable subdirectory.
pub(crate) fn mock_app() -> tauri::App<MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().identifier = "com.omniterm.tests".to_string();
    tauri::test::mock_builder()
        .build(context)
        .expect("build a mock app")
}
