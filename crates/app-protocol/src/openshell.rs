//! Cooperative launcher argv parsing.
//!
//! Ports Electron's `parseOpenShellArgs` (electron/services/launcher.ts). A `nc-open.cmd` / `wt.cmd`
//! shim on a pane's PATH re-invokes our exe with `--open-shell <shell> [flags]`; the single-instance
//! plugin forwards that argv to the running instance.
//!
//! That argv is UNTRUSTED — any local process can run `OmniTerm.exe --open-shell …`. The Electron
//! build validated it here before anything was spawned; the first Tauri port forwarded the raw argv
//! straight to the webview instead, which both broke the payload contract and let an arbitrary
//! executable name through. This module restores the allowlist and the length caps.

use crate::shell_spec::LocalShell;
use serde::{Deserialize, Serialize};

/// Length caps for untrusted argv. Generous but bounded.
const MAX_CWD: usize = 1024;
const MAX_COMMAND: usize = 4096;
const MAX_ARGS: usize = 2048;
const MAX_NAME: usize = 120;

/// A validated request to open a local shell pane.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenShellRequest {
    pub shell: LocalShell,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<String>,
    pub keep_open: bool,
    pub name: String,
}

/// Truncate to `max` chars (not bytes — slicing a multi-byte char would panic), treating an empty
/// value as absent.
fn cap(value: Option<&str>, max: usize) -> Option<String> {
    let v = value?;
    if v.is_empty() {
        return None;
    }
    Some(v.chars().take(max).collect())
}

/// Read a flag's value. A missing value, or one that looks like the next flag, counts as absent.
fn flag<'a>(argv: &'a [String], name: &str) -> Option<&'a str> {
    let idx = argv.iter().position(|a| a == name)?;
    let value = argv.get(idx + 1)?;
    if value.starts_with("--") {
        return None;
    }
    Some(value.as_str())
}

/// Parse `--open-shell <shell> [--cwd D] [--command C] [--args A] [--keep-open 0|1] [--name N]`
/// out of a full argv array.
///
/// Scans by token value because the flag index differs between a packaged launch and a dev launch.
/// Returns `None` on a missing or unrecognized `--open-shell` value — anything we do not recognize
/// is ignored, never spawned.
pub fn parse_open_shell_args(argv: &[String]) -> Option<OpenShellRequest> {
    let idx = argv.iter().position(|a| a == "--open-shell")?;
    let shell = LocalShell::parse(argv.get(idx + 1)?)?;
    if !shell.is_supported_here() {
        return None;
    }

    let keep_open_raw = flag(argv, "--keep-open");
    Some(OpenShellRequest {
        shell,
        cwd: cap(flag(argv, "--cwd"), MAX_CWD),
        command: cap(flag(argv, "--command"), MAX_COMMAND),
        args: cap(flag(argv, "--args"), MAX_ARGS),
        keep_open: !matches!(keep_open_raw, Some("0") | Some("false")),
        name: cap(flag(argv, "--name"), MAX_NAME)
            .unwrap_or_else(|| shell.default_name().to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    /// The shell name this platform accepts, so the suite runs on both Windows and POSIX.
    fn native_shell() -> (&'static str, LocalShell) {
        if cfg!(target_os = "windows") {
            ("powershell", LocalShell::Powershell)
        } else {
            ("bash", LocalShell::Bash)
        }
    }

    #[test]
    fn parses_a_full_request() {
        let (name, expected) = native_shell();
        let req = parse_open_shell_args(&argv(&[
            "OmniTerm.exe",
            "--open-shell",
            name,
            "--cwd",
            "C:/proj",
            "--command",
            "echo hi",
            "--args",
            "-NoLogo",
            "--keep-open",
            "1",
            "--name",
            "Deploy",
        ]))
        .expect("should parse");

        assert_eq!(
            req,
            OpenShellRequest {
                shell: expected,
                cwd: Some("C:/proj".to_string()),
                command: Some("echo hi".to_string()),
                args: Some("-NoLogo".to_string()),
                keep_open: true,
                name: "Deploy".to_string(),
            }
        );
    }

    #[test]
    fn finds_the_flag_at_any_index() {
        let (name, expected) = native_shell();
        // Dev launches insert the app root between the exe and our flags.
        let req = parse_open_shell_args(&argv(&[
            "electron.exe",
            "D:/workspace/OmniTerm",
            "--open-shell",
            name,
        ]))
        .expect("should parse");
        assert_eq!(req.shell, expected);
    }

    #[test]
    fn returns_none_without_the_flag() {
        assert!(parse_open_shell_args(&argv(&["OmniTerm.exe"])).is_none());
        assert!(parse_open_shell_args(&argv(&["OmniTerm.exe", "--other", "x"])).is_none());
    }

    #[test]
    fn returns_none_when_the_shell_value_is_missing() {
        assert!(parse_open_shell_args(&argv(&["OmniTerm.exe", "--open-shell"])).is_none());
    }

    /// The security property this module exists for: an arbitrary executable in the shell slot must
    /// produce no request at all.
    #[test]
    fn refuses_an_arbitrary_executable_in_the_shell_slot() {
        for hostile in [
            "C:\\Windows\\System32\\calc.exe",
            "calc.exe",
            "/bin/sh -c curl evil",
            "powershell.exe",
            "--cwd",
        ] {
            assert!(
                parse_open_shell_args(&argv(&["OmniTerm.exe", "--open-shell", hostile])).is_none(),
                "{hostile:?} must not produce a launch request"
            );
        }
    }

    #[test]
    fn refuses_a_shell_that_cannot_exist_on_this_platform() {
        let foreign = if cfg!(target_os = "windows") { "bash" } else { "cmd" };
        assert!(parse_open_shell_args(&argv(&["OmniTerm.exe", "--open-shell", foreign])).is_none());
    }

    #[test]
    fn defaults_the_name_to_the_shell_label() {
        let (name, expected) = native_shell();
        let req = parse_open_shell_args(&argv(&["x", "--open-shell", name])).unwrap();
        assert_eq!(req.name, expected.default_name());
    }

    #[test]
    fn keep_open_defaults_to_true_and_only_0_or_false_disable_it() {
        let (name, _) = native_shell();
        let parse_keep = |v: Option<&str>| {
            let mut a = vec!["x".to_string(), "--open-shell".to_string(), name.to_string()];
            if let Some(v) = v {
                a.push("--keep-open".to_string());
                a.push(v.to_string());
            }
            parse_open_shell_args(&a).unwrap().keep_open
        };
        assert!(parse_keep(None));
        assert!(parse_keep(Some("1")));
        assert!(parse_keep(Some("yes")));
        assert!(!parse_keep(Some("0")));
        assert!(!parse_keep(Some("false")));
    }

    #[test]
    fn treats_a_following_flag_as_an_absent_value() {
        let (name, _) = native_shell();
        let req =
            parse_open_shell_args(&argv(&["x", "--open-shell", name, "--cwd", "--name", "Tab"]))
                .unwrap();
        assert_eq!(req.cwd, None);
        assert_eq!(req.name, "Tab");
    }

    #[test]
    fn caps_untrusted_field_lengths() {
        let (name, _) = native_shell();
        let long_cwd = "a".repeat(MAX_CWD + 500);
        let long_name = "b".repeat(MAX_NAME + 500);
        let long_command = "c".repeat(MAX_COMMAND + 500);
        let long_args = "d".repeat(MAX_ARGS + 500);
        let req = parse_open_shell_args(&argv(&[
            "x",
            "--open-shell",
            name,
            "--cwd",
            &long_cwd,
            "--name",
            &long_name,
            "--command",
            &long_command,
            "--args",
            &long_args,
        ]))
        .unwrap();
        assert_eq!(req.cwd.unwrap().len(), MAX_CWD);
        assert_eq!(req.name.len(), MAX_NAME);
        assert_eq!(req.command.unwrap().len(), MAX_COMMAND);
        assert_eq!(req.args.unwrap().len(), MAX_ARGS);
    }

    /// Capping by chars, not bytes — a byte slice through a multi-byte character would panic.
    #[test]
    fn caps_multibyte_names_without_panicking() {
        let (name, _) = native_shell();
        let emoji_name = "🚀".repeat(MAX_NAME + 10);
        let req =
            parse_open_shell_args(&argv(&["x", "--open-shell", name, "--name", &emoji_name]))
                .unwrap();
        assert_eq!(req.name.chars().count(), MAX_NAME);
    }

    #[test]
    fn empty_flag_values_are_absent() {
        let (name, expected) = native_shell();
        let req =
            parse_open_shell_args(&argv(&["x", "--open-shell", name, "--cwd", "", "--name", ""]))
                .unwrap();
        assert_eq!(req.cwd, None);
        assert_eq!(req.name, expected.default_name());
    }
}
