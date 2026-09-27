//! Only this test process is inspected: no child is spawned and no other process's memory is read.

use super::*;
use std::ffi::OsString;

#[test]
fn keeps_only_profile_variables() {
    let environ: Vec<OsString> = [
        "PATH=C:\\bin",
        "claude_config_dir=C:\\p\\work",
        "CODEX_HOME=/home/me/.codex-alt",
        "ANTHROPIC_API_KEY=secret",
        "MALFORMED",
    ]
    .iter()
    .map(OsString::from)
    .collect();
    assert_eq!(
        profile_env(&environ),
        vec![
            ("claude_config_dir".to_string(), "C:\\p\\work".to_string()),
            ("CODEX_HOME".to_string(), "/home/me/.codex-alt".to_string()),
        ]
    );
}

#[test]
fn no_shells_or_targets_means_no_work() {
    let mut system = System::new();
    assert!(tree_rows(&mut system, &[]).is_empty());
    let mut rows: Vec<ProcRow> = Vec::new();
    fill_command_lines(&mut system, &mut rows, &[]);
    fill_profile_env(&mut system, &mut rows, &[]);
    assert!(start_times(&mut system, &[]).is_empty());
}

#[test]
fn reads_names_first_and_details_only_on_request() {
    let mut system = System::new();
    let own = std::process::id();
    let mut rows = tree_rows(&mut system, &[own]);
    let me = rows
        .iter()
        .position(|row| row.pid == own)
        .expect("own process row");
    assert!(!rows[me].image.is_empty());
    assert!(rows[me].start_time > 0);
    assert!(
        rows[me].cmd.is_empty() && rows[me].env.is_empty(),
        "phase 1 reads no memory"
    );

    fill_command_lines(&mut system, &mut rows, &[own]);
    assert!(!rows[me].cmd.is_empty());
    // Process-wide environment: serialised with every other test that touches it.
    let _guard = crate::test_support::lock();
    std::env::set_var("CODEX_HOME", "/tmp/agent-quota-test");
    let mut fresh = System::new();
    let mut again = tree_rows(&mut fresh, &[own]);
    fill_profile_env(&mut fresh, &mut again, &[own]);
    let mine = again.iter().find(|row| row.pid == own).expect("own row");
    assert!(mine.env.iter().any(|(key, _)| key == "CODEX_HOME"));
    std::env::remove_var("CODEX_HOME");
}

#[test]
fn start_times_report_only_live_processes() {
    let mut system = System::new();
    let own = std::process::id();
    let times = start_times(&mut system, &[own, u32::MAX - 1]);
    assert!(times.get(&own).is_some_and(|start| *start > 0));
    assert!(!times.contains_key(&(u32::MAX - 1)));
}

#[test]
fn home_dir_comes_from_the_environment() {
    assert!(home_dir().is_some_and(|home| !home.is_empty()));
}
