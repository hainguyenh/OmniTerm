//! The SSH sessions a user started by hand inside a local terminal (`ssh me@host` typed in pwsh),
//! so the Connections tool window can list them and offer to save one as a connection.
//!
//! Only process names, parents and start times are read for every process. The command line, which
//! sysinfo reads out of the process's memory on Windows, is read for `ssh` processes alone, and only
//! the destination (user, host, port) leaves this module: keys, forwards and remote commands do not.

use crate::proc_activity::ProcTable;
use crate::pty::PtyManager;
use app_core::ssh_target::parse_ssh_args;
use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{AppHandle, Manager, Runtime};

/// One `ssh` client running under a local terminal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSshSession {
    pub session_id: String,
    pub pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    pub host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<String>,
}

/// `ssh` or `ssh.exe`, any case.
fn is_ssh_image(image: &str) -> bool {
    let lower = image.to_ascii_lowercase();
    lower == "ssh" || lower == "ssh.exe"
}

/// Each terminal's `ssh` descendants: `(session id, pid)`, from `(session id, shell pid)` pairs.
fn ssh_pids(
    table: &ProcTable,
    shells: &[(String, u32)],
    image_of: impl Fn(u32) -> Option<String>,
) -> Vec<(String, u32)> {
    shells
        .iter()
        .flat_map(|(session, shell)| {
            table
                .descendants(*shell)
                .into_iter()
                .filter(|pid| image_of(*pid).is_some_and(|image| is_ssh_image(&image)))
                .map(move |pid| (session.clone(), pid))
        })
        .collect()
}

fn scan(shells: &[(String, u32)]) -> Vec<LocalSshSession> {
    if shells.is_empty() {
        return Vec::new();
    }
    let mut system = System::new();
    let table = ProcTable::snapshot(&mut system);
    let found = ssh_pids(&table, shells, |pid| {
        system
            .process(Pid::from_u32(pid))
            .map(|process| process.name().to_string_lossy().into_owned())
    });
    if found.is_empty() {
        return Vec::new();
    }
    let wanted: Vec<Pid> = found.iter().map(|(_, pid)| Pid::from_u32(*pid)).collect();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&wanted),
        false,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::OnlyIfNotSet),
    );
    found
        .into_iter()
        .filter_map(|(session_id, pid)| {
            let args: Vec<String> = system
                .process(Pid::from_u32(pid))?
                .cmd()
                .iter()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect();
            let target = parse_ssh_args(&args)?;
            Some(LocalSshSession {
                session_id,
                pid,
                user: target.user,
                host: target.host,
                port: target.port,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn local_ssh_sessions<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<LocalSshSession>, String> {
    let shells: Vec<(String, u32)> = app
        .try_state::<PtyManager>()
        .map(|manager| {
            manager
                .sessions
                .iter()
                .filter(|entry| !entry.ssh)
                .filter_map(|entry| entry.pid.map(|pid| (entry.key().clone(), pid)))
                .collect()
        })
        .unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || scan(&shells))
        .await
        .map_err(|error| format!("SSH session scan failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_ssh_clients_under_each_terminal_only() {
        let rows = [
            (10, 1, 0, "pwsh.exe"),
            (11, 10, 0, "ssh.exe"),
            (20, 1, 0, "pwsh.exe"),
            (21, 20, 0, "node.exe"),
            (30, 1, 0, "SSH.EXE"),
        ];
        let table = ProcTable::from_rows(rows);
        let image = |pid: u32| {
            rows.iter()
                .find(|row| row.0 == pid)
                .map(|row| row.3.to_string())
        };
        let shells = vec![("a".to_string(), 10), ("b".to_string(), 20)];
        assert_eq!(
            ssh_pids(&table, &shells, image),
            vec![("a".to_string(), 11)]
        );
    }

    #[test]
    fn matches_the_ssh_image_in_any_case() {
        assert!(is_ssh_image("ssh"));
        assert!(is_ssh_image("SSH.exe"));
        assert!(!is_ssh_image("sshd.exe"));
        assert!(!is_ssh_image("ssh-agent.exe"));
    }

    #[test]
    fn scans_nothing_without_terminals() {
        assert!(scan(&[]).is_empty());
    }
}
