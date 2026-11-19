//! Official IDE plugins that ship inside OmniTerm and are installed on first start, so the git,
//! run/test and editor features they provide work without a trip to the plugin market.
//!
//! The packages are staged (prebuilt components included) from `plugins/` into `builtin-plugins/` and bundled as
//! resources. Installing goes through the same `install_from_dir` the market uses, so they appear in
//! the plugin list, can be disabled, and are replaced whenever the bundled files change. A plugin the user uninstalls
//! is installed again on the next start: shipping it built in means it is part of the app.

use std::path::{Path, PathBuf};
use std::time::Duration;

use ide_app::state::AppState;
use ide_host::plugins::Consent;
use tauri::{AppHandle, Manager, Wry};

/// Git, run/test and editor plugins. The other official plugins in `plugins/` are left out on
/// purpose and stay installable by hand: `git-toolbox` only fetches every few minutes (the `vcs`
/// feature already shows ahead/behind), `license-header` checks every file on open and save, and
/// `solidity` serves a language few OmniTerm users write.
pub(crate) const BUILTIN_PLUGINS: &[&str] = &[
    "blame-annotations",
    "test-runner",
    "todo-finder",
    "string-tools",
    "csv-editor",
    "regex-tester",
    "material-icons",
    "harbor-night",
];

/// Official plugins that ship in the bundle but are never installed unasked: a copy the user
/// installed is replaced when its files differ from the bundled package. Without this an old build
/// (one made with a nightly toolchain burned its whole CPU budget while activating) keeps running.
pub(crate) const OPTIONAL_PLUGINS: &[&str] = &["git-toolbox", "license-header", "solidity"];

/// Optional plugins an earlier build installed (and so enabled) unasked. They are switched off once;
/// the marker file keeps a later choice of the user, including enabling it again, from being undone.
pub(crate) const DEFAULT_OFF_PLUGINS: &[&str] = &["license-header"];

/// Whether an installed default-off plugin must be switched off now: only before its marker exists.
pub(crate) fn needs_default_off(installed: bool, already_applied: bool) -> bool {
    installed && !already_applied
}

/// Switches off, once per installation, the default-off plugins an earlier build installed.
fn apply_default_off(app: &AppHandle<Wry>, state: &AppState, installed: &[String]) {
    let Ok(dir) = app.path().app_data_dir() else { return };
    let markers = dir.join("plugin-defaults");
    for id in DEFAULT_OFF_PLUGINS {
        let marker = markers.join(format!("{id}.off"));
        let plugin = plugin_id(id);
        if needs_default_off(installed.contains(&plugin), marker.is_file()) {
            if let Err(error) = state.plugins.set_enabled(&plugin, false) {
                log::warn!("[builtin-plugins] could not switch {id} off: {}", error.message);
                continue;
            }
        }
        let written = std::fs::create_dir_all(&markers).and_then(|()| std::fs::write(&marker, b""));
        if let Err(error) = written {
            log::warn!("[builtin-plugins] could not record that {id} is off by default: {error}");
        }
    }
}

/// How long the host gets to load the plugins it already has before the missing ones are counted.
const LOAD_GRACE: Duration = Duration::from_secs(4);

/// Plugin ids are `omniterm.<directory name>`.
fn plugin_id(directory: &str) -> String {
    format!("omniterm.{directory}")
}

fn package_roots(app: &AppHandle<Wry>) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = app
        .path()
        .resource_dir()
        .map(|dir| vec![dir.join("builtin-plugins")])
        .unwrap_or_default();
    // A debug build runs from `target/`, where the bundled copy may be stale or absent.
    if cfg!(debug_assertions) {
        roots.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("builtin-plugins"));
    }
    roots
}

/// The package directory of `id` in the first root that has one.
pub(crate) fn find_package(roots: &[PathBuf], id: &str) -> Option<PathBuf> {
    roots
        .iter()
        .map(|root| root.join(id))
        .find(|dir| dir.join("plugin.toml").is_file())
}

/// Whether a built-in plugin must be (re)installed: it is missing, or the installed copy was built
/// from other files than the bundled one. The second case matters because a copy installed on an
/// earlier start keeps running forever otherwise, even after the app ships a fixed component (a
/// component built with a nightly toolchain burned its whole CPU budget while activating).
pub(crate) fn needs_install(installed: bool, differs: impl FnOnce() -> bool) -> bool {
    !installed || differs()
}

/// Whether an optional plugin must be replaced: only an installed copy built from other files.
pub(crate) fn needs_refresh(installed: bool, differs: impl FnOnce() -> bool) -> bool {
    installed && differs()
}

/// The ids of the plugins the app ships and keeps installed, so the Plugins dialog can list them
/// as built in rather than as downloaded.
#[tauri::command]
pub fn builtin_plugin_ids() -> Vec<String> {
    BUILTIN_PLUGINS.iter().map(|id| plugin_id(id)).collect()
}

/// Installs, in the background, every built-in plugin the host does not list yet, and replaces
/// every installed one whose files differ from the bundled package.
pub(crate) fn install_missing(app: &AppHandle<Wry>) {
    let roots = package_roots(app);
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("builtin-plugins".into()).spawn(move || {
        std::thread::sleep(LOAD_GRACE);
        let Some(state) = app.try_state::<AppState>() else { return };
        let installed: Vec<String> = state.plugins.list(None).plugins.into_iter().map(|plugin| plugin.id).collect();
        apply_default_off(&app, &state, &installed);
        let builtin = BUILTIN_PLUGINS.iter().map(|id| (*id, true));
        for (id, always) in builtin.chain(OPTIONAL_PLUGINS.iter().map(|id| (*id, false))) {
            let Some(dir) = find_package(&roots, id) else {
                log::warn!("[builtin-plugins] no package for {id} in {roots:?}");
                continue;
            };
            let differs = || {
                state.plugins.installed_differs(&dir).unwrap_or_else(|error| {
                    log::warn!("[builtin-plugins] could not compare {id} with its installed copy: {}", error.message);
                    false
                })
            };
            let present = installed.contains(&plugin_id(id));
            let install = if always { needs_install(present, differs) } else { needs_refresh(present, differs) };
            if !install {
                continue;
            }
            if let Err(error) = state.plugins.install_from_dir(&dir, &Consent::all()) {
                log::warn!("[builtin-plugins] could not install {id}: {}", error.message);
            }
        }
    });
    if let Err(error) = spawned {
        log::warn!("[builtin-plugins] could not start the installer thread: {error}");
    }
}

#[cfg(test)]
#[path = "builtin_plugins_tests.rs"]
mod tests;
