//! POSIX shell resolution walked through one probe, so every fallback step is measured together.
//!
//! `resolve_posix_shell` is generic over its probe; giving each case its own closure would split the
//! cases across separate instantiations. `resolve_with` keeps one probe type for all of them.

use super::*;

/// Resolve `shell` with `SHELL` set to `env_shell` (or unset) and only `installed` executable.
fn resolve_with(
    shell: LocalShell,
    env_shell: Option<&str>,
    installed: &[&str],
) -> Result<String, String> {
    let previous = std::env::var_os("SHELL");
    match env_shell {
        Some(value) => std::env::set_var("SHELL", value),
        None => std::env::remove_var("SHELL"),
    }
    let result = resolve_posix_shell(shell, |path| installed.contains(&path));
    match previous {
        Some(value) => std::env::set_var("SHELL", value),
        None => std::env::remove_var("SHELL"),
    }
    result
}

#[test]
fn named_shells_resolve_under_bin_or_report_what_is_missing() {
    let _guard = crate::test_support::lock();
    assert_eq!(
        resolve_with(
            LocalShell::Bash,
            Some("/bin/fish"),
            &["/bin/bash", "/bin/fish"]
        ),
        Ok("/bin/bash".to_string())
    );
    assert_eq!(
        resolve_with(LocalShell::Sh, None, &["/bin/sh"]),
        Ok("/bin/sh".to_string())
    );
    assert_eq!(
        resolve_with(LocalShell::Zsh, None, &["/bin/bash"]),
        Err("/bin/zsh is not installed or executable.".to_string())
    );
}

#[test]
fn the_default_shell_walks_env_then_zsh_then_bash() {
    let _guard = crate::test_support::lock();
    assert_eq!(
        resolve_with(
            LocalShell::Default,
            Some("/opt/fish"),
            &["/opt/fish", "/bin/zsh"]
        ),
        Ok("/opt/fish".to_string())
    );
    assert_eq!(
        resolve_with(LocalShell::Default, Some("fish"), &["/bin/zsh"]),
        Ok("/bin/zsh".to_string())
    );
    assert_eq!(
        resolve_with(LocalShell::Default, None, &["/bin/zsh", "/bin/bash"]),
        Ok("/bin/zsh".to_string())
    );
    assert_eq!(
        resolve_with(LocalShell::Default, None, &["/bin/bash"]),
        Ok("/bin/bash".to_string())
    );
    assert_eq!(
        resolve_with(LocalShell::Default, None, &[]),
        Err("/bin/zsh is not installed or executable.".to_string())
    );
}
