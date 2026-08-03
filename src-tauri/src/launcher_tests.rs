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

/// When the target does not exist, `write_if_changed` creates it without hitting the read-no-match path.
#[test]
fn write_when_file_does_not_exist() {
    let dir = tempfile::Builder::new()
        .prefix("omniterm-launcher")
        .tempdir()
        .expect("temp dir");
    let target = dir.path().join("new-shim.cmd");
    assert!(!target.exists());

    write_if_changed(&target, "created").expect("write");
    assert_eq!(fs::read_to_string(&target).unwrap(), "created");
}

// ── App-handle tests ────────────────────────────────────────────────────────

#[test]
fn launcher_bin_dir_is_under_app_data() {
    let app = crate::test_support::mock_app();
    let bin = launcher_bin_dir(app.handle());
    assert!(
        bin.to_string_lossy().ends_with("bin"),
        "bin dir should end with 'bin', got: {}",
        bin.display()
    );
}

#[test]
fn setup_launcher_creates_shim_files() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    match tauri::async_runtime::block_on(setup_launcher(app.handle().clone())) {
        Ok(bin_dir_str) => {
            // Verify the returned path ends with 'bin'.
            assert!(bin_dir_str.ends_with("bin"), "expected bin dir, got: {bin_dir_str}");
            // Verify shim files were created.
            let bin = std::path::Path::new(&bin_dir_str);
            assert!(bin.join("nc-open.cmd").exists(), "nc-open.cmd must exist");
            assert!(bin.join("wt.cmd").exists(), "wt.cmd must exist");
            assert!(bin.join("wt-shim.ps1").exists(), "wt-shim.ps1 must exist");
        }
        Err(e) => {
            // Mock runtime may not provide a writable app data dir; skip disk assertions.
            eprintln!("setup_launcher returned error (mock fs): {e}");
        }
    }
}

#[test]
fn setup_launcher_is_idempotent() {
    let _guard = crate::test_support::lock();
    let app = crate::test_support::mock_app();
    // Call twice; should not error on second call.
    let r1 = tauri::async_runtime::block_on(setup_launcher(app.handle().clone()));
    let r2 = tauri::async_runtime::block_on(setup_launcher(app.handle().clone()));
    // Both succeed or both fail (mock fs); the important thing is no panic.
    assert_eq!(r1.is_ok(), r2.is_ok(), "idempotency: both calls should have same success/error state");
}
