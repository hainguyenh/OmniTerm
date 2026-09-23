// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn state_dir_arg(args: &[String]) -> Result<std::path::PathBuf, String> {
    let index = args
        .iter()
        .position(|arg| arg == "--state-dir")
        .ok_or_else(|| "--sessiond requires --state-dir <path>".to_string())?;
    args.get(index + 1)
        .filter(|value| !value.starts_with("--"))
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "--sessiond requires --state-dir <path>".to_string())
}

/// Variables a debugger (VS Code's JS debug auto-attach) injects into a dev launch. Every pane
/// inherits this process's environment, and Node/Bun CLIs such as Claude Code exit silently with
/// code 1 when `NODE_OPTIONS` carries inspector hooks — so a debug build would break them in a way
/// the Start-menu-launched production build never does.
const DEBUGGER_INJECTED_ENV: [&str; 2] = ["NODE_OPTIONS", "VSCODE_INSPECTOR_OPTIONS"];

/// Drop the debugger-injected variables in debug builds so panes start with the same environment
/// as production. `remove` is injectable so the policy stays testable without mutating the test
/// process's environment.
fn strip_debugger_env(debug_build: bool, mut remove: impl FnMut(&str)) {
    if debug_build {
        DEBUGGER_INJECTED_ENV.iter().for_each(|name| remove(name));
    }
}

fn main() {
    // Runs before any thread is spawned, so mutating the process environment is sound here. It also
    // covers `--sessiond`: a daemon started by a debug build hosts panes for every later app launch.
    strip_debugger_env(cfg!(debug_assertions), |name| std::env::remove_var(name));
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--sessiond") {
        let result = state_dir_arg(&args).and_then(session_core::run_daemon);
        if result.is_err() {
            std::process::exit(2);
        }
        return;
    }
    app_lib::run();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_builds_strip_debugger_injected_env_and_release_keeps_it() {
        let mut removed = Vec::new();
        strip_debugger_env(true, |name| removed.push(name.to_string()));
        assert_eq!(removed, ["NODE_OPTIONS", "VSCODE_INSPECTOR_OPTIONS"]);

        let mut untouched = Vec::new();
        strip_debugger_env(false, |name| untouched.push(name.to_string()));
        assert!(
            untouched.is_empty(),
            "release builds leave the environment alone"
        );
    }

    #[test]
    fn daemon_mode_requires_state_dir_value() {
        assert!(state_dir_arg(&["omniterm".into(), "--sessiond".into()]).is_err());
        assert_eq!(
            state_dir_arg(&[
                "omniterm".into(),
                "--sessiond".into(),
                "--state-dir".into(),
                "state".into(),
            ])
            .unwrap(),
            std::path::PathBuf::from("state")
        );
    }
}
