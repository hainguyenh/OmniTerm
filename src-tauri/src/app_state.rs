//! The state every command reads through `State<'_, T>`, registered once for the real app and for
//! the IPC contract tests, so a state added for a command cannot be missing in one of them.

use crate::{
    adhoc::AdhocRegistry, agent_quota::AgentQuotaState, always_awake::AlwaysAwakeState, ide,
    pty::PtyManager, rdp_embed::RdpSessionManager, terminal_window::DetachRegistry,
};

/// Registers the state shared by every window. The platform-specific launcher state is left to the
/// caller because tests use a sandboxed one.
pub(crate) fn manage_state<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .manage(PtyManager::new())
        .manage(ide::requests::Requests::default())
        .manage(AdhocRegistry::new())
        .manage(DetachRegistry::new())
        .manage(RdpSessionManager::new())
        .manage(AlwaysAwakeState::new())
        .manage(AgentQuotaState::new())
        .manage(crate::update_coordinator::UpdatesCoordinator::default())
}
