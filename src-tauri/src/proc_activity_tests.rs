//! Traversal rules of the process-tree probe, exercised through `from_rows` so no real process is
//! involved. Row shape: (pid, parent, start_time, image).

use super::*;

/// A shell (pid 100) with nothing under it, plus an unrelated tree.
fn idle_shell() -> ProcTable {
    ProcTable::from_rows([
        (1u32, 0u32, 0u64, "init"),
        (100, 1, 10, "powershell.exe"),
        (200, 1, 10, "explorer.exe"),
        (201, 200, 11, "notepad.exe"),
    ])
}

#[test]
fn a_shell_with_no_children_is_idle() {
    let table = idle_shell();
    assert!(!table.has_descendant(100));
    assert!(table.descendants(100).is_empty());
}

#[test]
fn another_processs_children_are_not_attributed_to_the_shell() {
    let table = idle_shell();
    assert!(table.has_descendant(200), "explorer really does have a child");
    assert!(!table.has_descendant(100));
}

#[test]
fn a_direct_child_makes_the_shell_busy() {
    let table = ProcTable::from_rows([(100u32, 1u32, 10u64, "cmd.exe"), (101, 100, 20, "ping.exe")]);
    assert!(table.has_descendant(100));
    assert_eq!(table.descendants(100), vec![101]);
}

#[test]
fn descendants_are_found_through_several_levels() {
    let table = ProcTable::from_rows([
        (100u32, 1u32, 10u64, "bash.exe"),
        (101, 100, 20, "make.exe"),
        (102, 101, 30, "cc.exe"),
        (103, 102, 40, "ld.exe"),
    ]);
    assert!(table.has_descendant(100));
    let mut found = table.descendants(100);
    found.sort_unstable();
    assert_eq!(found, vec![101, 102, 103]);
}

#[test]
fn an_unknown_pid_and_an_empty_table_report_idle() {
    assert!(!idle_shell().has_descendant(9999));
    assert!(!ProcTable::default().has_descendant(100));
    assert!(!ProcTable::from_rows(Vec::<(u32, u32, u64, &str)>::new()).has_descendant(100));
}

/// The regression this guards: PID reuse can produce a parent map that describes a cycle, and an
/// unguarded walk would hang the poller task rather than fail.
#[test]
fn a_parent_cycle_terminates() {
    let table = ProcTable::from_rows([
        (100u32, 101u32, 10u64, "a.exe"),
        (101, 100, 10, "b.exe"),
        (102, 101, 10, "c.exe"),
    ]);
    let mut found = table.descendants(100);
    found.sort_unstable();
    assert_eq!(found, vec![101, 102]);
}

#[test]
fn a_self_parented_process_is_not_its_own_descendant() {
    let table = ProcTable::from_rows([(100u32, 100u32, 10u64, "weird.exe")]);
    assert!(!table.has_descendant(100));
}

#[test]
fn a_root_is_not_a_child_of_pid_zero() {
    let table = ProcTable::from_rows([(4u32, 0u32, 0u64, "System"), (100, 0, 10, "pwsh.exe")]);
    assert!(!table.has_descendant(0));
}

/// A process that started *before* its claimed parent cannot really be its child — the parent's pid
/// was recycled. Equality must still count: a child spawned in the same second is genuine.
#[test]
fn a_child_older_than_its_parent_is_rejected_but_a_same_instant_child_is_kept() {
    let stale = ProcTable::from_rows([(100u32, 1u32, 500u64, "pwsh.exe"), (101, 100, 499, "old.exe")]);
    assert!(!stale.has_descendant(100), "start_time predates the parent");

    let same = ProcTable::from_rows([(100u32, 1u32, 500u64, "pwsh.exe"), (101, 100, 500, "new.exe")]);
    assert!(same.has_descendant(100));
}

/// ConPTY's console host is spawned beside the shell, not under it — but it is filtered regardless, so
/// a Windows build that reparents it cannot pin every pane to "running".
#[test]
fn the_console_host_never_counts_as_work() {
    for image in ["conhost.exe", "OpenConsole.exe", "CONHOST.EXE"] {
        let table = ProcTable::from_rows([(100u32, 1u32, 10u64, "pwsh.exe"), (101, 100, 20, image)]);
        assert!(!table.has_descendant(100), "{image} must not read as busy");
        assert_eq!(table.process_count(), 1, "{image} must not even be indexed");
    }
    // The filter is an exact image match, not a substring one.
    let table = ProcTable::from_rows([
        (100u32, 1u32, 10u64, "pwsh.exe"),
        (101, 100, 20, "conhost-wrapper.exe"),
    ]);
    assert!(table.has_descendant(100));
}

#[test]
fn a_real_snapshot_sees_this_process_tree() {
    let table = ProcTable::snapshot_now();
    assert!(table.process_count() > 1, "the machine has processes");
}
