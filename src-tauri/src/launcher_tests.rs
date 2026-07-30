//! Launcher shim content tests.

use super::*;

/// The regression this guards: the shim pointed at `%~dp0..\..\OmniTerm.exe`, i.e. two levels above
/// `<appData>/bin`, which is inside the user's AppData tree and never where the app is installed. The
/// shim has to name the real running executable.
#[test]
fn nc_open_invokes_the_actual_executable_path() {
    let exe = Path::new(r"C:\Program Files\OmniTerm\OmniTerm.exe");
    let contents = nc_open_contents(exe);
    assert!(
        contents.contains(r#""C:\Program Files\OmniTerm\OmniTerm.exe" --open-shell %*"#),
        "got {contents}"
    );
    assert!(
        !contents.contains(".."),
        "the shim must not use a relative hop: {contents}"
    );
}

/// The exe path is quoted, or an install path containing a space breaks the shim.
#[test]
fn the_executable_path_is_quoted() {
    let contents = nc_open_contents(Path::new(r"C:\Program Files\OmniTerm\OmniTerm.exe"));
    let line = contents.lines().nth(1).expect("second line");
    assert!(line.starts_with('"'), "got {line}");
}

/// `%*` forwards the caller's arguments; without it every `nc-open` invocation would open a bare
/// default shell.
#[test]
fn nc_open_forwards_all_arguments_after_the_flag() {
    let contents = nc_open_contents(Path::new("C:/OmniTerm.exe"));
    let flag = contents.find("--open-shell").expect("flag present");
    let star = contents.find("%*").expect("forwarding present");
    assert!(star > flag, "%* must come after --open-shell");
}

#[test]
fn batch_shims_use_crlf_and_suppress_echo() {
    for contents in [nc_open_contents(Path::new("C:/x.exe")), wt_cmd_contents()] {
        assert!(contents.starts_with("@echo off\r\n"), "got {contents}");
        assert!(contents.ends_with("\r\n"));
    }
}

#[test]
fn wt_cmd_delegates_to_the_shim_beside_it() {
    let contents = wt_cmd_contents();
    assert!(contents.contains(r#""%~dp0wt-shim.ps1""#), "got {contents}");
    // -NoProfile keeps a user profile from changing how the shim parses arguments.
    assert!(contents.contains("-NoProfile"));
}

/// The shim must fall through to the real `wt.exe` for anything it cannot map, rather than silently
/// doing something different from what the user asked for.
#[test]
fn wt_shim_falls_through_to_the_real_windows_terminal() {
    let shim = wt_shim_contents();
    assert!(shim.contains("function Invoke-RealWt"));
    assert!(shim.contains("wt.exe"));
    // Cases it explicitly refuses to map.
    for unsupported in ["split-pane", "'sp'", "';'"] {
        assert!(shim.contains(unsupported), "{unsupported} not handled");
    }
}

/// The shim only ever produces one of the allowlisted shell names, so its output still passes
/// `parse_open_shell_args`.
#[test]
fn wt_shim_emits_only_allowlisted_shell_names() {
    use crate::shell_spec::LocalShell;
    let shim = wt_shim_contents();
    for emitted in ["'powershell'", "'cmd'", "'wsl'"] {
        assert!(shim.contains(emitted), "{emitted} missing");
        let name = emitted.trim_matches('\'');
        assert!(
            LocalShell::parse(name).is_some(),
            "{name} is not in the allowlist"
        );
    }
}

#[test]
fn wt_shim_routes_through_nc_open() {
    let shim = wt_shim_contents();
    assert!(shim.contains("nc-open.cmd"));
    assert!(shim.contains("--cwd") && shim.contains("--name") && shim.contains("--command"));
}

#[test]
fn write_if_changed_leaves_matching_content_alone() {
    let dir = tempfile::Builder::new()
        .prefix("omniterm-launcher")
        .tempdir()
        .expect("temp dir");
    let target = dir.path().join("nc-open.cmd");

    write_if_changed(&target, "first").expect("write");
    assert_eq!(fs::read_to_string(&target).unwrap(), "first");
    let before = fs::metadata(&target).unwrap().modified().unwrap();

    write_if_changed(&target, "first").expect("no-op write");
    assert_eq!(fs::metadata(&target).unwrap().modified().unwrap(), before);

    write_if_changed(&target, "second").expect("rewrite");
    assert_eq!(fs::read_to_string(&target).unwrap(), "second");
}
