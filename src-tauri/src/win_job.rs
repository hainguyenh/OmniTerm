//! Windows Job Objects: reaping a shell's orphaned descendants.
//!
//! A batch script that shells out to `wsl.exe` (or anything else leaving a background helper behind)
//! can keep a process alive long after the shell OmniTerm spawned — and the pane showing it — are
//! gone. A job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` lets pty.rs take that whole tree down once
//! the shell exits, rather than leaking it for the life of the app.

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

pub struct JobHandle(HANDLE);

// A job handle is an opaque kernel-object reference; neither TerminateJobObject nor CloseHandle cares
// which thread it is called from.
unsafe impl Send for JobHandle {}
unsafe impl Sync for JobHandle {}

/// Create a kill-on-close job and put `raw_handle`'s process in it, so terminating (or dropping) the
/// returned handle takes the whole process tree with it.
pub fn assign_new_job(raw_handle: std::os::windows::io::RawHandle) -> Result<JobHandle, String> {
    unsafe {
        let job = CreateJobObjectW(None, None).map_err(|e| e.to_string())?;

        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .map_err(|e| e.to_string())?;

        if let Err(e) = AssignProcessToJobObject(job, HANDLE(raw_handle as *mut _)) {
            let _ = CloseHandle(job);
            return Err(e.to_string());
        }

        Ok(JobHandle(job))
    }
}

impl JobHandle {
    /// Force down every process still in the job. Called once the shell itself has exited, so whatever
    /// is left is an orphaned descendant.
    pub fn terminate(&self, exit_code: u32) {
        // Not evidence of failure: the tree may already be fully exited, which reports as an error but
        // leaves nothing to clean up.
        if let Err(e) = unsafe { TerminateJobObject(self.0, exit_code) } {
            log::debug!("[pty] job termination reported: {e}");
        }
    }
}

impl Drop for JobHandle {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.0) };
    }
}
