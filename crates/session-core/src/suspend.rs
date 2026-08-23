//! Process-tree suspension for FreezeWhileClosed sessions.
//!
//! Windows has no SIGSTOP, so freezing uses ntdll's stable
//! NtSuspendProcess/NtResumeProcess pair over every pid in the session tree.
//! Unix shells are spawned by portable-pty with setsid(), making the root pid
//! the process-group leader, so one signal reaches the whole tree.

#[cfg(windows)]
fn descendant_pids(root_pid: u32) -> Vec<u32> {
    let mut system = sysinfo::System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let mut children: std::collections::HashMap<u32, Vec<u32>> = std::collections::HashMap::new();
    for (pid, process) in system.processes() {
        if let Some(parent) = process.parent() {
            children
                .entry(parent.as_u32())
                .or_default()
                .push(pid.as_u32());
        }
    }
    let mut ordered = Vec::new();
    let mut queue = std::collections::VecDeque::from([root_pid]);
    while let Some(current) = queue.pop_front() {
        ordered.push(current);
        if let Some(kids) = children.get(&current) {
            queue.extend(kids.iter().copied());
        }
    }
    ordered
}

#[cfg(windows)]
fn apply_to_tree(root_pid: u32, suspend: bool) -> Result<(), String> {
    #[link(name = "ntdll")]
    extern "system" {
        fn NtSuspendProcess(process_handle: *mut core::ffi::c_void) -> i32;
        fn NtResumeProcess(process_handle: *mut core::ffi::c_void) -> i32;
    }
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SUSPEND_RESUME};

    // NTSTATUS severity-success codes are non-negative.
    let nt_success = |status: i32| status >= 0;

    for (index, pid) in descendant_pids(root_pid).into_iter().enumerate() {
        // SAFETY: handle-based Win32 calls; each handle is closed before the
        // next iteration.
        unsafe {
            let Ok(handle) = OpenProcess(PROCESS_SUSPEND_RESUME, false, pid) else {
                // The process may have exited between snapshot and open; only
                // the root pid is load-bearing.
                if index == 0 {
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
                if index == 0 {
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
pub fn suspend_tree(root_pid: u32) -> Result<(), String> {
    apply_to_tree(root_pid, true)
}

#[cfg(windows)]
pub fn resume_tree(root_pid: u32) -> Result<(), String> {
    apply_to_tree(root_pid, false)
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
pub fn process_start_time(root_pid: u32) -> Option<u64> {
    let mut system = sysinfo::System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    system
        .processes()
        .get(&sysinfo::Pid::from_u32(root_pid))
        .map(|process| process.start_time())
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
        suspend_tree(pid).expect("first suspend succeeds");
        suspend_tree(pid).expect("second suspend is an idempotent success");
        resume_tree(pid).expect("resume succeeds");
        resume_tree(pid).expect("second resume is an idempotent success");
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
        let reported = process_start_time(child.id());
        assert!(
            reported.is_some(),
            "start time should resolve for a live pid"
        );
        child.kill().expect("cleanup kill");
        child.wait().expect("cleanup reap");
    }
}
