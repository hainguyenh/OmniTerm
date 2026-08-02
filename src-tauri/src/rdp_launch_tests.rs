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

#[cfg(target_os = "linux")]
#[test]
fn launch_reports_the_platform_error_before_spawning_any_process() {
    let err = launch_rdp("/tmp/host.rdp").expect_err("Linux has no built-in RDP client");
    assert!(err.contains("No Remote Desktop client"), "got {err}");
}
