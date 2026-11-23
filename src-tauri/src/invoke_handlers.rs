//! Registration of every IPC command. Kept out of `lib.rs` so that file stays within the size limit.

#[allow(clippy::wildcard_imports)] // The handler paths are written relative to the crate root.
use crate::*;

#[cfg(test)]
pub(crate) fn with_invoke_handler<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
) -> tauri::Builder<R> {
    builder.invoke_handler(local_invoke_handler())
}

/// Every command in this file's table, in the shape `Builder::invoke_handler` takes, so the embedded
/// omniterm backend (`idea_host`) can route the commands it does not answer itself.
pub(crate) fn local_invoke_handler<R: tauri::Runtime>(
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // The workbench's project follows the active workspace; every other workbench command is
        // answered by the embedded backend (idea_host.rs).
        ide::project_bridge::ide_set_project,
        // PTY
        pty::start_local_session,
        pty::send_session_input,
        pty_interrupt::interrupt_session,
        pty::resize_session,
        pty::ack_session_output,
        pty::disconnect_session,
        pty_resolve::prepare_ssh_session,
        // RDP. No `rdp_set_bounds` / `rdp_set_visible`: both bodies were empty, so the renderer
        // positioned a window that was never reparented and got no error saying so. Docking, if
        // built, belongs to a plugin — see the note at the top of rdp_embed.rs.
        rdp_embed::connect_rdp,
        rdp_embed::rdp_disconnect,
        // Detached terminal windows
        terminal_window::detach_terminal,
        terminal_window::bootstrap_terminal_window,
        terminal_window::report_detached_terminal_context,
        terminal_window::attach_session,
        terminal_window::reattach_terminal,
        terminal_window::focus_terminal_window,
        terminal_window::release_terminal_window,
        // Settings
        settings::get_settings,
        settings::save_settings,
        // Settings transfer (export / import envelope)
        settings_transfer::export_settings,
        settings_transfer::import_settings,
        // Native updater
        update_manager::check_for_native_update,
        update_manager::download_and_install_update,
        update_manager::app_check_update,
        update_manager::app_install_update,
        update_manager::app_cancel_update,
        update_manager::app_update_window_ready,
        update_manager::app_update_status,
        update_manager::app_update_announcement,
        update_manager::app_restart,
        // Themes
        themes::list_themes,
        themes::save_theme,
        themes::delete_theme,
        themes::open_themes_folder,
        // Custom art
        custom_art::upload_custom_art,
        custom_art::get_custom_art,
        custom_art::remove_custom_art,
        // Connections
        connections::load_connections,
        connections::save_connections,
        connections::export_json,
        connections::export_text,
        connections::import_json,
        connections::import_file,
        // Window control
        window_control::minimize_window,
        window_control::toggle_maximize,
        window_control::close_window,
        window_control::is_maximized,
        window_control::set_webview_zoom,
        window_control::set_fullscreen,
        // Workspace
        workspace::list_workspaces,
        workspace::create_workspace,
        workspace::add_workspace,
        workspace_folders::add_workspace_folder,
        workspace_folders::remove_workspace_folder,
        workspace_folders::rename_workspace_folder,
        workspace_folders::set_workspace_folder_disabled,
        workspace_lifecycle::import_workspace_file,
        workspace_lifecycle::export_workspace_file,
        workspace_lifecycle::remove_workspace,
        workspace_lifecycle::rename_workspace,
        workspace_appearance::set_workspace_appearance,
        workspace_appearance::set_workspace_folder_color,
        workspace::move_workspace,
        workspace::set_workspace_entry_pinned,
        workspace::scan_scripts,
        workspace::scan_workspace_folders,
        workspace::scan_workspace_entries,
        workspace::run_script,
        workspace::read_script,
        workspace::write_script,
        workspace_file_commands::create_workspace_directory,
        workspace_file_commands::move_workspace_file,
        workspace_file_commands::delete_workspace_file,
        temp_note_commands::list_temp_notes,
        temp_note_commands::read_temp_note,
        temp_note_commands::write_temp_note,
        temp_note_commands::delete_temp_note,
        temp_note_commands::save_temp_note_as,
        safepath_command::system_excluded_view_exts,
        workspace_connections::load_workspace_connections,
        workspace_connections_write::save_workspace_connection,
        workspace_connections_write::delete_workspace_connection,
        ssh_sessions::local_ssh_sessions,
        // App utils
        app_utils::reveal_log,
        app_utils::clear_log,
        app_utils::get_version,
        app_utils::open_in_system,
        // Ad-hoc shells + launcher
        adhoc::shells_ready,
        adhoc::shells_release,
        adhoc::open_quick_shell,
        shell_probe::list_available_shells,
        launcher::setup_launcher,
        // Built-in features and bundled IDE plugins
        omni_plugin_list,
        crate::builtin_plugins::builtin_plugin_ids,
        omni_plugin_set_enabled,
        always_awake::get_state,
        always_awake::set_state,
        always_awake::disable,
        always_awake::always_awake_info,
        agent_quota::usage_commands::agent_quota_info,
        agent_quota::usage_commands::agent_quota_fetch_usage,
        agent_quota::usage_commands::agent_quota_bridge_reading,
        agent_quota::usage_commands::agent_quota_wake,
        agent_quota::usage_commands::agent_quota_list_profiles,
        agent_quota::usage_commands::agent_quota_probe_dir,
        agent_quota::bridge_commands::agent_quota_claude_bridge_status,
        agent_quota::bridge_commands::agent_quota_claude_bridge_install,
        agent_quota::bridge_commands::agent_quota_claude_bridge_remove,
        agent_quota::bridge_commands::agent_quota_agy_bridge_status,
        agent_quota::bridge_commands::agent_quota_agy_bridge_install,
        agent_quota::bridge_commands::agent_quota_agy_bridge_remove,
        agent_quota::bridge_commands::agent_quota_statusline_text,
        agent_quota::usage_commands::agent_quota_ensure_passive,
        agent_quota::agent_quota_detect,
        agent_quota::agent_quota_profile_census,
        agent_quota::agent_quota_suspend,
        agent_quota::agent_quota_resume,
        agent_quota::agent_quota_resume_all,
        agent_quota::agent_quota_terminate,
        agent_quota::agent_quota_get_held,
        agent_quota::agent_quota_resume_pid,
        agent_session::resolve_claude_session,
        agent_session::resolve_agent_model,
        agent_session::export_claude_transcript,
        agent_session::agent_sessions_load,
        agent_session::agent_sessions_save,
        agent_session_cleanup::agent_session_profiles_list,
        agent_session_cleanup::agent_session_files_list,
        agent_session_cleanup::agent_session_files_delete,
        agent_session_cleanup::agent_session_files_delete_cancel,
        temp_cleanup::temp_cleanup_scan,
        temp_cleanup::temp_cleanup_run,
        temp_cleanup::temp_cleanup_cancel,
        attachments::save_temp_image,
        attachments::save_attachment,
        attachments::import_clipboard_files,
        attachments::list_attachments,
        attachments::clear_attachments,
        attachments::move_attachments,
        // Git
    ]
}

/// The names of the commands registered above, read from this file's own source so the list cannot
/// drift from the table. Module paths and comment words land in the set too; none is a command name
/// the embedded backend would also answer, so they never change a routing decision.
pub(crate) fn local_command_names() -> std::collections::HashSet<&'static str> {
    include_str!("invoke_handlers.rs")
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .filter(|word| !word.is_empty())
        .collect()
}
