use super::*;

fn packages_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("builtin-plugins")
}

fn shipped() -> impl Iterator<Item = &'static &'static str> {
    BUILTIN_PLUGINS.iter().chain(OPTIONAL_PLUGINS)
}

#[test]
fn every_builtin_plugin_has_a_staged_package() {
    let roots = [packages_dir()];
    for id in shipped() {
        assert!(
            find_package(&roots, id).is_some(),
            "builtin-plugins/{id}/plugin.toml is missing"
        );
    }
}

#[test]
fn plugins_with_code_ship_their_component() {
    let roots = [packages_dir()];
    for id in shipped() {
        let dir = find_package(&roots, id).expect("package present");
        let manifest = std::fs::read_to_string(dir.join("plugin.toml")).expect("manifest readable");
        if manifest
            .lines()
            .any(|line| line.trim_start().starts_with("wasm"))
        {
            assert!(
                dir.join("dist/plugin.wasm").is_file(),
                "{id} lists a component that is not staged"
            );
        }
    }
}

#[test]
fn staged_components_match_the_official_builds() {
    // A stale staged copy ships an old component: `pnpm stage:plugins` refreshes it.
    let official = Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugins/official");
    for id in shipped() {
        let staged = packages_dir().join(id).join("dist/plugin.wasm");
        if !staged.is_file() {
            continue;
        }
        let built = std::fs::read(official.join(id).join("dist/plugin.wasm"))
            .expect("official component readable");
        let shipped = std::fs::read(&staged).expect("staged component readable");
        assert!(
            built == shipped,
            "{id}: the staged component is stale; run `pnpm stage:plugins`"
        );
    }
}

#[test]
fn the_dialog_learns_the_builtin_ids_but_not_the_optional_ones() {
    let ids = builtin_plugin_ids();
    assert!(ids.contains(&"omniterm.todo-finder".to_string()));
    assert!(
        !ids.contains(&"omniterm.git-toolbox".to_string()),
        "optional plugins are installed by the user"
    );
    assert_eq!(ids.len(), BUILTIN_PLUGINS.len());
}

#[test]
fn an_unknown_package_is_not_found() {
    assert!(find_package(&[packages_dir()], "no-such-plugin").is_none());
}

#[test]
fn background_and_niche_plugins_are_not_built_in() {
    // Built-in plugins are reinstalled on every start, so these must stay off the list to stay uninstalled.
    for id in ["git-toolbox", "license-header", "solidity"] {
        assert!(!BUILTIN_PLUGINS.contains(&id), "{id} is built in");
    }
    assert_eq!(BUILTIN_PLUGINS.len(), 8);
}

#[test]
fn a_missing_or_changed_plugin_is_installed_and_an_unchanged_one_is_left_alone() {
    assert!(needs_install(false, || panic!(
        "a missing plugin is not compared"
    )));
    assert!(
        needs_install(true, || true),
        "a stale installed copy is replaced"
    );
    assert!(!needs_install(true, || false));
}

#[test]
fn an_optional_plugin_is_only_replaced_when_installed_and_changed() {
    assert!(!needs_refresh(false, || panic!(
        "a plugin the user never installed is not compared"
    )));
    assert!(
        needs_refresh(true, || true),
        "an old build the user installed is replaced"
    );
    assert!(!needs_refresh(true, || false));
}

#[test]
fn license_header_is_switched_off_once_when_an_earlier_build_installed_it() {
    assert!(DEFAULT_OFF_PLUGINS.contains(&"license-header"));
    assert!(!BUILTIN_PLUGINS.contains(&"license-header"), "a built-in plugin is never off by default");
    assert!(needs_default_off(true, false), "an installed copy without the marker is switched off");
    assert!(!needs_default_off(true, true), "the user's later choice is kept");
    assert!(!needs_default_off(false, false), "nothing to switch off when it is not installed");
}

#[test]
fn the_builtin_list_names_no_plugin_twice() {
    let mut ids: Vec<_> = shipped().collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), BUILTIN_PLUGINS.len() + OPTIONAL_PLUGINS.len());
}

#[test]
fn a_package_directory_name_maps_to_the_id_in_its_manifest() {
    let roots = [packages_dir()];
    for id in shipped() {
        let dir = find_package(&roots, id).expect("package present");
        let manifest = std::fs::read_to_string(dir.join("plugin.toml")).expect("manifest readable");
        let expected = format!("id = \"{}\"", plugin_id(id));
        assert!(
            manifest.lines().any(|line| line.trim() == expected),
            "{id}: manifest id is not {}",
            plugin_id(id)
        );
    }
}
