//! Freeze, thaw and stop single processes with documented platform APIs only.
//!
//! Windows has no documented whole-process suspend, so a process is frozen thread by thread: a
//! Toolhelp snapshot lists its threads and `SuspendThread` / `ResumeThread` hold and release each
//! one. The ids of the threads this module suspended are returned and kept by the caller, so every
//! suspend is matched by exactly one resume — suspend counts never drift, and a thread the agent
//! created after the freeze is caught by the next call without re-suspending the others. (The
//! undocumented NT native-API whole-process suspend did this in one call, but it is also a
//! favourite of malware and made the binary look like it to heuristic scanners.) Unix uses SIGSTOP/SIGCONT
//! through `kill`, which avoids a libc dependency and has no per-thread state.

#[cfg(windows)]
mod platform {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, OpenThread, ResumeThread, SuspendThread, TerminateProcess, PROCESS_TERMINATE,
        THREAD_SUSPEND_RESUME,
    };

    /// Closes a handle when dropped, so every early return releases it.
    struct Owned(HANDLE);

    impl Drop for Owned {
        fn drop(&mut self) {
            // SAFETY: the handle came from a successful Win32 open call and is closed exactly once.
            let _ = unsafe { CloseHandle(self.0) };
        }
    }

    /// Thread ids currently owned by `pid`.
    fn threads_of(pid: u32) -> Result<Vec<u32>, String> {
        // SAFETY: CreateToolhelp32Snapshot has no preconditions; failure is returned as an error.
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) }
            .map(Owned)
            .map_err(|e| format!("Could not list threads: {e}"))?;
        let mut entry = THREADENTRY32 {
            dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
            ..Default::default()
        };
        let mut out = Vec::new();
        // SAFETY: `entry` is a properly sized THREADENTRY32 and the snapshot handle is live.
        let mut more = unsafe { Thread32First(snapshot.0, &mut entry) }.is_ok();
        while more {
            if entry.th32OwnerProcessID == pid {
                out.push(entry.th32ThreadID);
            }
            // SAFETY: as above.
            more = unsafe { Thread32Next(snapshot.0, &mut entry) }.is_ok();
        }
        Ok(out)
    }

    /// Apply `action` to one thread; false when the thread is gone or refused. `action` receives
    /// a live handle carrying THREAD_SUSPEND_RESUME and returns the Win32 result (`u32::MAX` on
    /// failure).
    fn with_thread(tid: u32, action: impl FnOnce(HANDLE) -> u32) -> bool {
        // SAFETY: OpenThread has no preconditions; failure (thread exited) is handled.
        let Ok(handle) = (unsafe { OpenThread(THREAD_SUSPEND_RESUME, false, tid) }) else {
            return false;
        };
        let handle = Owned(handle);
        action(handle.0) != u32::MAX
    }

    /// Suspend every thread of `pid` not already in `held`, re-listing until no new thread
    /// appears, so a thread spawned mid-freeze is not missed. Returns the threads suspended now.
    pub fn suspend(pid: u32, held: &[u32]) -> Result<Vec<u32>, String> {
        const ROUNDS: usize = 5;
        let mut done: Vec<u32> = Vec::new();
        for round in 0..ROUNDS {
            let fresh: Vec<u32> = threads_of(pid)?
                .into_iter()
                .filter(|tid| !held.contains(tid) && !done.contains(tid))
                .collect();
            if fresh.is_empty() {
                if round == 0 && held.is_empty() {
                    return Err(format!("Process {pid} has no threads to suspend"));
                }
                break;
            }
            done.extend(
                fresh
                    .into_iter()
                    // SAFETY: `with_thread` hands over a live handle with suspend rights.
                    .filter(|&tid| with_thread(tid, |handle| unsafe { SuspendThread(handle) })),
            );
        }
        Ok(done)
    }

    /// Resume exactly the threads this module suspended. Threads that have since exited are
    /// skipped; there is nothing left to release for them.
    pub fn resume(_pid: u32, threads: &[u32]) -> Result<(), String> {
        for &tid in threads {
            // SAFETY: `with_thread` hands over a live handle with resume rights.
            with_thread(tid, |handle| unsafe { ResumeThread(handle) });
        }
        Ok(())
    }

    pub fn terminate(pid: u32) -> Result<(), String> {
        // SAFETY: OpenProcess has no preconditions; a failure is returned as an error.
        let handle = unsafe { OpenProcess(PROCESS_TERMINATE, false, pid) }
            .map(Owned)
            .map_err(|e| format!("Could not open process {pid}: {e}"))?;
        // SAFETY: the handle is live and carries PROCESS_TERMINATE.
        unsafe { TerminateProcess(handle.0, 1) }
            .map_err(|e| format!("Could not stop process {pid}: {e}"))
    }
}

#[cfg(not(windows))]
mod platform {
    fn signal(pid: u32, signal: &str, verb: &str) -> Result<(), String> {
        let status = std::process::Command::new("kill")
            .args([signal, &pid.to_string()])
            .status()
            .map_err(|e| format!("Could not {verb} process {pid}: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("Could not {verb} process {pid}"))
        }
    }

    /// SIGSTOP freezes the whole process at once; there are no per-thread ids to keep.
    pub fn suspend(pid: u32, _held: &[u32]) -> Result<Vec<u32>, String> {
        signal(pid, "-STOP", "suspend").map(|()| Vec::new())
    }

    pub fn resume(pid: u32, _threads: &[u32]) -> Result<(), String> {
        signal(pid, "-CONT", "resume")
    }

    pub fn terminate(pid: u32) -> Result<(), String> {
        signal(pid, "-KILL", "stop")
    }
}

pub use platform::{resume, suspend, terminate};

#[cfg(test)]
#[path = "process_suspend_tests.rs"]
mod tests;
