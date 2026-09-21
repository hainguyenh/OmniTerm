//! Session-preserving Stop command for local terminals.

use crate::pty::PtyManager;
use sysinfo::{Pid, System};

#[cfg(test)]
#[path = "pty_interrupt_tests.rs"]
mod tests;

fn session_descendants_snapshot(root_pid: u32) -> (System, Vec<u32>) {
    let mut system = System::new();
    let table = app_core::proc_activity::ProcTable::snapshot(&mut system);
    (system, table.descendants(root_pid))
}

fn terminate_session_descendants(system: &System, mut descendants: Vec<u32>) {
    // Kill leaves before their parents where possible. The shell itself is deliberately excluded:
    // Stop means "stop what this shell is running", not "destroy the terminal session".
    descendants.reverse();
    for pid in descendants {
        if let Some(process) = system.process(Pid::from_u32(pid)) {
            let _ = process.kill();
        }
    }
}

#[tauri::command]
pub async fn interrupt_session(
    state: tauri::State<'_, PtyManager>,
    id: String,
) -> Result<(), String> {
    // A restored/detached session may not have been cached in this renderer yet. Refresh once so
    // the process-tree kill still targets the daemon-owned shell rather than degrading silently.
    let mut root_pid = state.sessions.get(&id).and_then(|session| session.pid);
    if root_pid.is_none() {
        state.refresh().await?;
        root_pid = state.sessions.get(&id).and_then(|session| session.pid);
    }

    // Snapshot descendants before ETX so a prompt process spawned during recovery cannot be
    // mistaken for the command the user asked to stop.
    let descendants = root_pid.map(session_descendants_snapshot);

    // ETX handles shell built-ins and gives interactive programs their normal Ctrl+C semantics.
    // Immediately reap the pre-existing descendants too, so an uncooperative foreground program
    // cannot force the user through a delayed second click. The root shell remains alive and ready.
    state.client()?.input(id, "\x03".to_string()).await?;
    if let Some((system, descendants)) = descendants {
        terminate_session_descendants(&system, descendants);
    }
    Ok(())
}
