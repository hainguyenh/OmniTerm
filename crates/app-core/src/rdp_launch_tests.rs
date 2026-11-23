//! Which Remote Desktop client each platform gets, and what it is handed.

use super::*;

#[test]
fn windows_hands_the_file_to_mstsc() {
    let (exe, args) = rdp_command(r"D:\ws\host.rdp", "windows").unwrap();
    assert_eq!(exe, "mstsc.exe");
    assert_eq!(args, vec![r"D:\ws\host.rdp"]);
}

#[test]
fn macos_forwards_to_the_registered_handler() {
    let (exe, args) = rdp_command("/ws/host.rdp", "macos").unwrap();
    assert_eq!(exe, "open");
    assert_eq!(args, vec!["/ws/host.rdp"]);
}

/// There is no Remote Desktop client to assume on Linux, and guessing one (xfreerdp, remmina) would
/// mean spawning a program the user never installed. Say so instead.
#[test]
fn an_unsupported_platform_is_a_readable_error() {
    let err = rdp_command("/ws/host.rdp", "linux").expect_err("must reject");
    assert!(err.contains("No Remote Desktop client"), "got {err}");
}

/// The path is passed as a single argument, so a space in it cannot split into two.
#[test]
fn a_path_with_spaces_stays_one_argument() {
    let (_, args) = rdp_command(r"D:\my ws\prod host.rdp", "windows").unwrap();
    assert_eq!(args.len(), 1);
    assert_eq!(args[0], r"D:\my ws\prod host.rdp");
}

#[test]
fn the_address_omits_the_default_port_and_keeps_any_other() {
    assert_eq!(rdp_address("server01", "").unwrap(), "server01");
    assert_eq!(rdp_address("10.0.0.1", "3389").unwrap(), "10.0.0.1");
    assert_eq!(
        rdp_address("desk.corp", " 3390 ").unwrap(),
        "desk.corp:3390"
    );
    assert_eq!(rdp_address("[fe80::1]", "3390").unwrap(), "[fe80::1]:3390");
}

/// The address becomes `/v:<address>` and a registry key name, so nothing that could be read as a
/// switch, a second argument or a key path may survive.
#[test]
fn the_address_rejects_hosts_and_ports_that_are_not_plain() {
    for host in [
        "", "/admin", "-x", "a b", r"a\b", "a/b", "a;b", "[]", "[zz]", "a\"b",
    ] {
        assert!(rdp_address(host, "").is_err(), "{host:?} must be rejected");
    }
    for port in ["0", "65536", "x", "-1"] {
        assert!(
            rdp_address("host", port).is_err(),
            "{port:?} must be rejected"
        );
    }
}

#[test]
fn the_username_hint_targets_the_address_key_and_never_a_password() {
    let args = username_hint_args("desk:3390", " CORP\\me ").unwrap();
    assert_eq!(
        args[1],
        r"HKCU\Software\Microsoft\Terminal Server Client\Servers\desk:3390"
    );
    assert_eq!(args[3], "UsernameHint");
    assert_eq!(args[7], r"CORP\me");
    assert!(!args
        .iter()
        .any(|arg| arg.to_lowercase().contains("password")));
    for user in ["", "  ", "/f", "-x", "me\nroot"] {
        assert!(username_hint_args("desk", user).is_none(), "{user:?}");
    }
}

#[cfg(target_os = "linux")]
#[test]
fn launch_reports_the_platform_error_before_spawning_any_process() {
    let err = launch_rdp("/tmp/host.rdp").expect_err("Linux has no built-in RDP client");
    assert!(err.contains("No Remote Desktop client"), "got {err}");
}

#[cfg(unix)]
#[test]
fn detached_launcher_covers_success_and_spawn_failure() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::test_support::lock();
    let original_path = std::env::var_os("PATH");
    let tools = tempfile::tempdir().unwrap();
    let opener = tools.path().join("open");
    fs::write(&opener, "#!/bin/sh\nexit 0\n").unwrap();
    let mut permissions = fs::metadata(&opener).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&opener, permissions).unwrap();
    std::env::set_var("PATH", tools.path());

    launch_rdp_for_os("/tmp/coverage host.rdp", "macos").unwrap();
    fs::remove_file(&opener).unwrap();
    let error = launch_rdp_for_os("/tmp/coverage host.rdp", "macos").unwrap_err();
    assert!(error.contains("Could not start open"), "got {error}");

    match original_path {
        Some(value) => std::env::set_var("PATH", value),
        None => std::env::remove_var("PATH"),
    }
}

#[cfg(windows)]
#[test]
fn detached_launcher_covers_spawn_failure_on_windows() {
    let _guard = crate::test_support::lock();

    let error = launch_rdp_for_os("C:\\coverage\0.rdp", "windows").unwrap_err();
    assert!(error.contains("Could not start mstsc.exe"), "got {error}");

    let error2 = launch_rdp("C:\\coverage\0.rdp").unwrap_err();
    assert!(error2.contains("Could not start mstsc.exe"), "got {error2}");
}
