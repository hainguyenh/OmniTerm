//! PowerShell Editor Services needs its bundle folder (`PSES_BUNDLE_PATH`): the launch
//! command in `languages/powershell.toml` expands it inside `pwsh`, so an unset variable
//! made `pwsh` run `/PowerShellEditorServices/Start-EditorServices.ps1` and crash on loop.

use ide_language::LanguageServerConfig;
use std::path::{Path, PathBuf};

const SERVER: &str = "powershell-editor-services";
const BUNDLE_VAR: &str = "PSES_BUNDLE_PATH";
const START_SCRIPT: &str = "PowerShellEditorServices/Start-EditorServices.ps1";
/// Editors that ship the bundle in their PowerShell extension (`<ext>/modules`).
const EXTENSION_DIRS: [&str; 4] =
    [".vscode/extensions", ".vscode-insiders/extensions", ".vscode-oss/extensions", ".cursor/extensions"];

fn is_bundle(dir: &Path) -> bool {
    dir.join(START_SCRIPT).is_file()
}

/// The bundle folder: `explicit` (a configured or inherited `PSES_BUNDLE_PATH`) when it is
/// one, else the newest `ms-vscode.powershell-*` extension under `extension_roots`.
pub fn find_bundle(explicit: Option<&str>, extension_roots: &[PathBuf]) -> Option<PathBuf> {
    if let Some(dir) = explicit.filter(|d| !d.is_empty()).map(PathBuf::from) {
        return is_bundle(&dir).then_some(dir);
    }
    let mut found: Vec<PathBuf> = extension_roots
        .iter()
        .filter_map(|root| std::fs::read_dir(root).ok())
        .flatten()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("ms-vscode.powershell-"))
        .map(|e| e.path().join("modules"))
        .filter(|dir| is_bundle(dir))
        .collect();
    found.sort();
    found.pop()
}

/// Points the server at its bundle, or reports that none is installed instead of letting
/// `pwsh` crash on an empty path.
pub fn configure_pses(cfg: &mut LanguageServerConfig, home: Option<&Path>) {
    if cfg.name != SERVER || !cfg.args.iter().any(|a| a.contains(BUNDLE_VAR)) {
        return;
    }
    let explicit = cfg.env.get(BUNDLE_VAR).cloned().or_else(|| std::env::var(BUNDLE_VAR).ok());
    let roots: Vec<PathBuf> = home.map(|h| EXTENSION_DIRS.iter().map(|d| h.join(d)).collect()).unwrap_or_default();
    match find_bundle(explicit.as_deref(), &roots) {
        Some(bundle) => {
            cfg.env.insert(BUNDLE_VAR.into(), bundle.to_string_lossy().into_owned());
        }
        None => {
            cfg.launch_error = Some(
                cfg.install_hint
                    .clone()
                    .unwrap_or_else(|| format!("Set {BUNDLE_VAR} to the PowerShellEditorServices folder")),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle_in(root: &Path, ext: &str) -> PathBuf {
        let modules = root.join(ext).join("modules");
        std::fs::create_dir_all(modules.join("PowerShellEditorServices")).expect("create bundle dir");
        std::fs::write(modules.join(START_SCRIPT), "").expect("write start script");
        modules
    }

    fn config(args: &[&str]) -> LanguageServerConfig {
        LanguageServerConfig {
            name: SERVER.into(),
            command: "pwsh".into(),
            args: args.iter().map(|a| a.to_string()).collect(),
            env: Default::default(),
            root_markers: vec![],
            require_root_marker: false,
            initialization_options: None,
            settings: None,
            install_hint: Some("install the bundle".into()),
            connect: None,
            fallback: false,
            features: vec![],
            code_action_kinds: vec![],
            max_java: None,
            launch_error: None,
            tsserver_project: false,
            tsserver_project_extras: Default::default(),
            resync_on_configuration: false,
            file_only: false,
            pinned: None,
        }
    }

    #[test]
    fn finds_the_newest_extension_bundle() {
        let tmp = tempfile::tempdir().expect("tempdir");
        bundle_in(tmp.path(), "ms-vscode.powershell-2024.1.0");
        let newest = bundle_in(tmp.path(), "ms-vscode.powershell-2025.2.0");
        assert_eq!(find_bundle(None, &[tmp.path().to_path_buf()]), Some(newest));
    }

    #[test]
    fn an_explicit_path_must_hold_the_start_script() {
        let tmp = tempfile::tempdir().expect("tempdir");
        assert_eq!(find_bundle(Some(&tmp.path().to_string_lossy()), &[]), None);
        let bundle = bundle_in(tmp.path(), "x");
        assert_eq!(find_bundle(Some(&bundle.to_string_lossy()), &[]), Some(bundle));
    }

    #[test]
    fn a_missing_bundle_is_a_launch_error_not_a_crash_loop() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let mut cfg = config(&["-Command", "& \"$env:PSES_BUNDLE_PATH/x\""]);
        // Only meaningful when the machine does not export the variable itself.
        if std::env::var_os(BUNDLE_VAR).is_none() {
            configure_pses(&mut cfg, Some(tmp.path()));
            assert_eq!(cfg.launch_error.as_deref(), Some("install the bundle"));
        }
    }

    #[test]
    fn a_found_bundle_is_exported_to_the_server() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let bundle = bundle_in(&tmp.path().join(".vscode/extensions"), "ms-vscode.powershell-2025.2.0");
        let mut cfg = config(&["$env:PSES_BUNDLE_PATH"]);
        cfg.env.insert(BUNDLE_VAR.into(), String::new());
        configure_pses(&mut cfg, Some(tmp.path()));
        assert!(cfg.launch_error.is_none());
        assert_eq!(cfg.env.get(BUNDLE_VAR).map(PathBuf::from), Some(bundle));
    }

    #[test]
    fn other_servers_are_untouched() {
        let mut cfg = config(&["$env:PSES_BUNDLE_PATH"]);
        cfg.name = "other".into();
        configure_pses(&mut cfg, None);
        assert!(cfg.launch_error.is_none() && cfg.env.is_empty());
    }
}
