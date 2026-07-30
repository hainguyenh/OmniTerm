mod app_utils;
mod launcher;
mod settings;
mod themes;
mod window_control;

// Public so the integration tests under tests/ can drive the real launch and command paths.
pub mod adhoc;
pub mod connections;
pub mod launch;
pub mod openshell;
pub mod proc_activity;
pub mod pty;
pub mod pty_resolve;
pub mod rdp_launch;
pub mod session_activity;
pub mod session_output;
pub mod safepath;
pub mod shell_probe;
pub mod shell_spec;
pub mod terminal_window;
pub mod tree_validate;
pub mod workspace;
pub mod workspace_connections;
pub mod workspace_scan;
pub mod workspace_launch;
pub mod plugin_host;
pub mod plugin_host_api;
pub mod plugin_management;
pub mod credential_vault;
pub mod rdp_embed;
#[cfg(windows)]
pub mod win_job;

use adhoc::AdhocRegistry;
use plugin_host::PluginHost;
use pty::PtyManager;
use rdp_embed::RdpSessionManager;
use tauri::{Emitter, Manager, RunEvent, State};
use terminal_window::DetachRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The single-instance plugin must be registered first so a second launch is forwarded before
        // any other plugin has a chance to initialize against a duplicate instance.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            handle_second_instance(app, &argv);
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .manage(PtyManager::new())
        .manage(AdhocRegistry::new())
        .manage(DetachRegistry::new())
        .manage(PluginHost::new())
        .manage(RdpSessionManager::new())
        .setup(|app| {
            // Logging is a development-only facility. `#[cfg]` (not `cfg!`) so the registration is
            // not even compiled into a release or portable build: nothing installs a logger, so no
            // log directory is created and no line is ever written to disk. Cargo.toml's
            // `release_max_level_off` closes the other half — the `log::*!` call sites themselves
            // compile away — so the two together mean a packaged build has no log to deny access to.
            #[cfg(debug_assertions)]
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // Start the Node.js plugin host sidecar.
            //
            // Spawned, not `block_on`-ed: this runs inside `setup()`, so blocking here held the window
            // closed until a Node process had started — a cost paid on every launch, including builds
            // and machines with no plugins at all. Nothing in the first frame needs the host, and every
            // caller already handles it not being up yet.
            let host_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let host = host_handle.state::<PluginHost>();
                if let Err(e) = host.start(&host_handle).await {
                    log::warn!("[setup] plugin host did not start: {e}");
                }
            });

            // A missing main window is a packaging error, not a runtime condition to panic on.
            let Some(window) = app.get_webview_window("main") else {
                log::error!("[setup] no 'main' window in tauri.conf.json");
                return Ok(());
            };
            #[cfg(debug_assertions)]
            window.open_devtools();

            let win_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Resized(_) = event {
                    let is_max = win_clone.is_maximized().unwrap_or(false);
                    let _ = win_clone.emit("maximized-state", is_max);
                }
            });

            // An older build persisted connection passwords in plaintext. This build has no field to
            // put one in, so serde would simply ignore the key and leave the secret sitting on disk
            // until some unrelated save happened to rewrite the file. Delete it now, before the
            // renderer can ask for the tree.
            connections::scrub_stored_secrets(app.handle());

            // `.rdp` files name a host and a username. Nothing used to remove them, so every session
            // ever launched left one in the cache directory.
            rdp_embed::sweep_stale_temp_files(app.handle());

            // Tells each pane whether its shell is running something (tab busy/idle indicator).
            session_activity::spawn_poller(app.handle().clone());

            // This launch may itself carry --open-shell (the shim can start a cold instance).
            let handle = app.handle().clone();
            let argv: Vec<String> = std::env::args().collect();
            if let Some(req) = openshell::parse_open_shell_args(&argv) {
                adhoc::open_adhoc_shell(&handle, req);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // PTY
            pty::start_local_session,
            pty::send_session_input,
            pty::resize_session,
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
            terminal_window::attach_session,
            terminal_window::reattach_terminal,
            terminal_window::focus_terminal_window,
            terminal_window::release_terminal_window,
            // Settings
            settings::get_settings,
            settings::save_settings,
            // Themes
            themes::list_themes,
            themes::save_theme,
            themes::delete_theme,
            themes::open_themes_folder,
            // Connections
            connections::load_connections,
            connections::save_connections,
            connections::export_json,
            connections::import_json,
            connections::import_file,
            // Window control
            window_control::minimize_window,
            window_control::toggle_maximize,
            window_control::close_window,
            window_control::is_maximized,
            // Workspace
            workspace::list_workspaces,
            workspace::add_workspace,
            workspace::remove_workspace,
            workspace::scan_scripts,
            workspace::scan_workspace_entries,
            workspace::run_script,
            workspace::read_script,
            workspace::write_script,
            workspace_connections::load_workspace_connections,
            workspace_connections::save_workspace_connections,
            workspace_connections::delete_workspace_connection,
            // App utils
            app_utils::reveal_log,
            app_utils::clear_log,
            app_utils::open_external,
            app_utils::get_version,
            app_utils::get_home_dir,
            app_utils::get_platform,
            app_utils::cleanup_rdp_cert,
            // Ad-hoc shells + launcher
            adhoc::shells_ready,
            adhoc::shells_release,
            adhoc::open_quick_shell,
            shell_probe::list_available_shells,
            launcher::setup_launcher,
            // Plugin host commands
            plugin_available,
            plugin_list,
            plugin_management::install_plugin_package,
            plugin_management::remove_plugin,
            plugin_management::restart_app,
            plugin_set_enabled,
            plugin_select_connection_provider,
            connection_provider_capabilities,
            prompt_save_connection_credential,
            plugin_invoke,
            plugin_auth_gate,
            check_updates,
            get_update_state,
            skip_version,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Quitting closes every window, including detached ones. Latch that first, or each
            // detached window's Destroyed handler runs its kill-or-fold branch on the way out —
            // reaping sessions during teardown and emitting fold-back events at a main window that
            // is itself closing.
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                if let Some(registry) = app.try_state::<DetachRegistry>() {
                    registry.begin_shutdown();
                }
            }
        });
}

/// A second launch arrived. Its argv is untrusted — any local process can run
/// `OmniTerm.exe --open-shell …` — so it goes through `parse_open_shell_args`, which allowlists the
/// shell and caps every field. The first port emitted the raw argv array straight to the webview,
/// which both broke the payload contract and let an arbitrary executable name through.
fn handle_second_instance(app: &tauri::AppHandle, argv: &[String]) {
    if let Some(req) = openshell::parse_open_shell_args(argv) {
        adhoc::open_adhoc_shell(app, req);
    } else if argv.iter().any(|a| a == "--open-shell") {
        log::warn!("[launcher] ignored an --open-shell request with an unsupported shell");
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// ── Plugin Host Commands ──────────────────────────────────────────────

#[tauri::command]
async fn plugin_available(app: tauri::AppHandle, host: State<'_, PluginHost>) -> Result<bool, String> {
    host.start(&app).await?;
    Ok(host.is_available().await)
}

#[tauri::command]
async fn plugin_list(
    app: tauri::AppHandle,
    host: State<'_, PluginHost>,
) -> Result<Vec<serde_json::Value>, String> {
    // Setup starts the host in the background. Awaiting the same serialized start here prevents the
    // Settings panel from winning that race and incorrectly rendering "0 installed".
    host.start(&app).await?;
    host.list_plugins().await
}

#[tauri::command]
async fn plugin_set_enabled(
    host: State<'_, PluginHost>,
    id: String,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    host.set_enabled(id, enabled).await
}

#[tauri::command]
async fn plugin_select_connection_provider(
    host: State<'_, PluginHost>,
    id: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    host.select_connection_provider(id).await
}

#[tauri::command]
async fn connection_provider_capabilities(
    host: State<'_, PluginHost>,
) -> Result<Option<serde_json::Value>, String> {
    host.connection_capabilities().await
}

#[tauri::command]
async fn prompt_save_connection_credential(
    host: State<'_, PluginHost>,
    connection_id: String,
    username: String,
) -> Result<bool, String> {
    if connection_id.is_empty()
        || connection_id.len() > 200
        || connection_id
            .chars()
            .any(|value| value.is_control() || matches!(value, '/' | '\\'))
    {
        return Err("Invalid connection id.".to_string());
    }
    let selected = host
        .list_plugins()
        .await?
        .into_iter()
        .find(|plugin| {
            plugin
                .get("selectedConnectionProvider")
                .and_then(|value| value.as_bool())
                == Some(true)
        })
        .ok_or_else(|| "No active connection provider.".to_string())?;
    let plugin_id = selected
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "The active provider has no id.".to_string())?;
    let may_store = selected
        .get("permissions")
        .and_then(|value| value.as_array())
        .is_some_and(|permissions| {
            permissions
                .iter()
                .any(|value| value.as_str() == Some("credentials"))
        });
    if !may_store {
        return Err(
            "The active connection provider does not permit credential storage.".to_string(),
        );
    }
    let stored = credential_vault::prompt_and_set(
        plugin_id,
        &format!("connection:{connection_id}"),
        &username,
    )?;
    if !stored {
        return Ok(false);
    }
    let confirmation = host
        .invoke(
            "confirmStoredCredential".to_string(),
            vec![serde_json::Value::String(connection_id)],
        )
        .await?;
    if confirmation.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        return Err(
            confirmation
                .get("error")
                .and_then(|value| value.as_str())
                .unwrap_or("The provider could not attach the saved credential.")
                .to_string(),
        );
    }
    Ok(true)
}

#[tauri::command]
async fn plugin_invoke(
    host: State<'_, PluginHost>,
    method: String,
    args: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    host.invoke(method, args).await
}

#[tauri::command]
async fn plugin_auth_gate(host: State<'_, PluginHost>) -> Result<bool, String> {
    host.auth_gate().await
}

#[tauri::command]
async fn check_updates() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!(null))
}

#[tauri::command]
async fn get_update_state() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!(null))
}

#[tauri::command]
async fn skip_version(_version: Option<String>) -> Result<(), String> {
    Ok(())
}
