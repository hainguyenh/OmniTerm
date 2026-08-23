//! Process-tree suspension for FreezeWhileClosed sessions.
//!
//! Windows has no SIGSTOP, so freezing uses ntdll's stable
//! NtSuspendProcess/NtResumeProcess pair over every pid in the session tree.
//! Unix shells are spawned by portable-pty with setsid(), making the root pid
//! the process-group leader, so one signal reaches the whole tree.
//!
//! Every public entry point takes a [`ProcIndex`] built by [`index_processes`]:
//! ONE whole-machine snapshot serves descendant lookup and start-time reads,
//! so a freeze/resume costs a single enumeration instead of two or three.

/// Precomputed view of one process-table refresh. Reused for every query of a
/// freeze or resume operation — never refresh inside the queries.
pub struct ProcIndex {
    #[cfg(windows)]
    children: std::collections::HashMap<u32, Vec<u32>>,
    start_times: std::collections::HashMap<u32, u64>,
}

/// Take one whole-machine snapshot and index it. This is the only expensive
/// call in a freeze/resume cycle; keep it out of per-pid loops.
pub fn index_processes() -> ProcIndex {
    let mut system = sysinfo::System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let mut index = ProcIndex {
        #[cfg(windows)]
        children: std::collections::HashMap::new(),
        start_times: std::collections::HashMap::new(),
    };
    for (pid, process) in system.processes() {
        index.start_times.insert(pid.as_u32(), process.start_time());
        #[cfg(windows)]
        if let Some(parent) = process.parent() {
            index
                .children
                .entry(parent.as_u32())
                .or_default()
                .push(pid.as_u32());
        }
    }
    index
}

#[cfg(windows)]
fn descendant_pids(index: &ProcIndex, root_pid: u32) -> Vec<u32> {
    let mut ordered = Vec::new();
    let mut queue = std::collections::VecDeque::from([root_pid]);
    while let Some(current) = queue.pop_front() {
        ordered.push(current);
        if let Some(kids) = index.children.get(&current) {
            queue.extend(kids.iter().copied());
        }
    }
    ordered
}

#[cfg(windows)]
fn apply_to_tree(index: &ProcIndex, root_pid: u32, suspend: bool) -> Result<(), String> {
    #[link(name = "ntdll")]
    extern "system" {
        fn NtSuspendProcess(process_handle: *mut core::ffi::c_void) -> i32;
        fn NtResumeProcess(process_handle: *mut core::ffi::c_void) -> i32;
    }
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SUSPEND_RESUME};

    // NTSTATUS severity-success codes are non-negative.
    let nt_success = |status: i32| status >= 0;

    for (index_pos, pid) in descendant_pids(index, root_pid).into_iter().enumerate() {
        // SAFETY: handle-based Win32 calls; each handle is closed before the
        // next iteration.
        unsafe {
            let Ok(handle) = OpenProcess(PROCESS_SUSPEND_RESUME, false, pid) else {
                // The process may have exited between snapshot and open; only
                // the root pid is load-bearing.
                if index_pos == 0 {
                    return Err(format!("Could not open root process {pid}"));
                }
                continue;
            };
            let status = if suspend {
                NtSuspendProcess(handle.0)
            } else {
                NtResumeProcess(handle.0)
            };
            let _ = CloseHandle(handle);
            if !nt_success(status) {
                if index_pos == 0 {
                    return Err(format!(
                        "ntdll call failed for root pid {pid}: NTSTATUS {status:#x}"
                    ));
                }
                log::debug!("[sessiond] ntdll call failed for pid {pid}: {status:#x}");
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
pub fn suspend_tree(index: &ProcIndex, root_pid: u32) -> Result<(), String> {
    apply_to_tree(index, root_pid, true)
}

#[cfg(windows)]
pub fn resume_tree(index: &ProcIndex, root_pid: u32) -> Result<(), String> {
    apply_to_tree(index, root_pid, false)
}

#[cfg(unix)]
fn send_group_signal(root_pid: u32, signal: i32) -> Result<(), String> {
    let pgid = root_pid as libc::pid_t;
    // Negative pid targets the whole process group spawned under the shell.
    if unsafe { libc::kill(-pgid, signal) } == 0 {
        return Ok(());
    }
    // Fall back to the leader alone when the group vanished or the child was
    // spawned outside our own group (as in unit tests).
    if unsafe { libc::kill(pgid, signal) } == 0 {
        return Ok(());
    }
    Err(std::io::Error::last_os_error().to_string())
}

#[cfg(unix)]
pub fn suspend_tree(root_pid: u32) -> Result<(), String> {
    send_group_signal(root_pid, libc::SIGSTOP)
}

#[cfg(unix)]
pub fn resume_tree(root_pid: u32) -> Result<(), String> {
    send_group_signal(root_pid, libc::SIGCONT)
}

/// Boot-time identity anchor for the frozen-orphan sweep: seconds since epoch.
/// Reads from the shared snapshot — no extra refresh.
pub fn process_start_time(index: &ProcIndex, root_pid: u32) -> Option<u64> {
    index.start_times.get(&root_pid).copied()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::time::Duration;

    fn spawn_long_child() -> std::process::Child {
        #[cfg(windows)]
        let child = Command::new("cmd.exe")
            .args(["/c", "ping -n 30 127.0.0.1 > nul"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn cmd child");
        #[cfg(not(windows))]
        let child = Command::new("/bin/sh")
            .args(["-c", "sleep 30"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sh child");
        // Let the shell settle so the pid is discoverable in a fresh snapshot.
        std::thread::sleep(Duration::from_millis(300));
        child
    }

    #[test]
    fn suspend_and_resume_are_idempotent_and_keep_child_alive() {
        let mut child = spawn_long_child();
        let pid = child.id();
        // ONE snapshot serves the whole freeze/resume cycle.
        let index = index_processes();
        suspend_tree(&index, pid).expect("first suspend succeeds");
        suspend_tree(&index, pid).expect("second suspend is an idempotent success");
        resume_tree(&index, pid).expect("resume succeeds");
        resume_tree(&index, pid).expect("second resume is an idempotent success");
        assert!(
            child.try_wait().expect("child status readable").is_none(),
            "child must survive a freeze/resume round trip"
        );
        child.kill().expect("cleanup kill");
        child.wait().expect("cleanup reap");
    }

    #[test]
    fn start_time_is_reported_for_live_process() {
        let mut child = spawn_long_child();
        let index = index_processes();
        let reported = process_start_time(&index, child.id());
        assert!(
            reported.is_some(),
            "start time should resolve for a live pid"
        );
        child.kill().expect("cleanup kill");
        child.wait().expect("cleanup reap");
    }
}
