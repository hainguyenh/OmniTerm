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
