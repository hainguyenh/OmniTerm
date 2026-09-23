//! Process identity lookup used only by legacy frozen-session orphan cleanup.
//!
//! Process suspension/resumption was removed with terminal process persistence. A single sysinfo
//! snapshot remains so startup can verify the pid/start-time pair from an old manifest before
//! reaping a process that an older build left SIGSTOPped.

pub struct ProcIndex {
    start_times: std::collections::HashMap<u32, u64>,
}

pub fn index_processes() -> ProcIndex {
    let mut system = sysinfo::System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let start_times = system
        .processes()
        .iter()
        .map(|(pid, process)| (pid.as_u32(), process.start_time()))
        .collect();
    ProcIndex { start_times }
}

pub fn process_start_time(index: &ProcIndex, pid: u32) -> Option<u64> {
    index.start_times.get(&pid).copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_start_time_distinguishes_known_and_unknown_pids() {
        let index = ProcIndex {
            start_times: std::collections::HashMap::from([(7, 42)]),
        };
        assert_eq!(process_start_time(&index, 7), Some(42));
        assert_eq!(process_start_time(&index, 8), None);
    }
}
