//! Legacy frozen-session orphan cleanup.
//!
//! New OmniTerm sessions are always close-with-app and can never enter a frozen state. The only
//! remaining responsibility here is cleaning up a SIGSTOPped Unix process left by an older build
//! after a daemon crash. The persisted pid is signalled only when its recorded start time still
//! matches, so a recycled pid is never killed.

#[cfg(unix)]
pub(crate) fn kill_frozen_orphans_sweep(
    interrupted: &dashmap::DashMap<String, crate::manifest::SessionManifest>,
) {
    let index = crate::suspend::index_processes();
    for record in interrupted.iter() {
        if !record.frozen {
            continue;
        }
        let (Some(pid), Some(start_time)) = (record.pid, record.start_time) else {
            continue;
        };
        if crate::suspend::process_start_time(&index, pid) != Some(start_time) {
            continue;
        }
        // SAFETY: signal delivery; identity was double-checked via start time.
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGKILL);
        }
        log::debug!("[sessiond] reaped frozen orphan pid {pid}");
    }
}

#[cfg(not(unix))]
pub(crate) fn kill_frozen_orphans_sweep(
    _interrupted: &dashmap::DashMap<String, crate::manifest::SessionManifest>,
) {
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use session_protocol::PersistencePolicy;
    use std::time::Duration;

    fn legacy_manifest(id: &str) -> crate::manifest::SessionManifest {
        crate::manifest::SessionManifest::live(
            id.to_string(),
            1,
            PersistencePolicy::FreezeWhileClosed,
            "legacy".to_string(),
            false,
            false,
            false,
        )
    }

    fn spawn_child() -> std::process::Child {
        let child = std::process::Command::new("/bin/sh")
            .args(["-c", "sleep 30"])
            .spawn()
            .expect("spawn child");
        std::thread::sleep(Duration::from_millis(100));
        child
    }

    #[test]
    fn sweep_kills_matching_legacy_frozen_process() {
        let mut child = spawn_child();
        let index = crate::suspend::index_processes();
        let mut record = legacy_manifest("frozen");
        record.frozen = true;
        record.pid = Some(child.id());
        record.start_time = crate::suspend::process_start_time(&index, child.id());
        assert!(record.start_time.is_some());

        let interrupted = dashmap::DashMap::new();
        interrupted.insert(record.id.clone(), record);
        kill_frozen_orphans_sweep(&interrupted);

        let status = child.wait().expect("reap child");
        assert!(!status.success());
    }

    #[test]
    fn sweep_skips_non_frozen_incomplete_and_recycled_identities() {
        let mut child = spawn_child();
        let index = crate::suspend::index_processes();
        let start = crate::suspend::process_start_time(&index, child.id()).expect("start time");

        let interrupted = dashmap::DashMap::new();

        let plain = legacy_manifest("plain");
        interrupted.insert(plain.id.clone(), plain);

        let mut missing_start = legacy_manifest("missing-start");
        missing_start.frozen = true;
        missing_start.pid = Some(child.id());
        interrupted.insert(missing_start.id.clone(), missing_start);

        let mut missing_pid = legacy_manifest("missing-pid");
        missing_pid.frozen = true;
        missing_pid.start_time = Some(start);
        interrupted.insert(missing_pid.id.clone(), missing_pid);

        let mut recycled = legacy_manifest("recycled");
        recycled.frozen = true;
        recycled.pid = Some(child.id());
        recycled.start_time = Some(start.saturating_add(1));
        interrupted.insert(recycled.id.clone(), recycled);

        kill_frozen_orphans_sweep(&interrupted);
        assert!(child.try_wait().expect("child status").is_none());

        child.kill().expect("cleanup kill");
        child.wait().expect("cleanup reap");
    }
}
