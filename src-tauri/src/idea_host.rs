//! Embeds the IDE backend (`crates/ide-app`) in the OmniTerm app.
//!
//! `ide_app` owns the IDE's state (`AppState`, one `Host` with a project per window label) and every
//! `#[tauri::command]` behind `ui/ide/bindings.ts`. This module only plugs it into OmniTerm's builder:
//!
//! * `attach` registers the plugins, managed state and the single invoke handler. A command that
//!   `invoke_handlers.rs` already answers stays with OmniTerm's own handler; every other command goes
//!   to the `ide_app` one. As the terminal shell moves into `ide_app`, entries leave the local
//!   table and this routing needs no change.
//! * `setup` and `on_window_event` run the parts of `ide_app::run()` that make its commands work
//!   (create `AppState`, release a window's project when it closes).
//!
//! `ide_app`'s own window creation, menu bar and single-instance handling are deliberately not used:
//! OmniTerm's `main` window and title bar are the shell for now.

use std::collections::HashSet;
use std::error::Error;

use ide_app::application_focus::ApplicationFocus;
use ide_app::state::AppState;
use ide_app::windows::WindowsState;
use ide_app::{commands, plugin_web};
use tauri::{Manager, Window, WindowEvent, Wry};
use tauri::ipc::Invoke;

use crate::invoke_handlers::{local_command_names, local_invoke_handler};

/// Registers the embedded backend on `builder` and installs the routing invoke handler.
pub(crate) fn attach(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    let local = local_invoke_handler::<Wry>();
    let local_names: HashSet<&'static str> = local_command_names();
    let upstream = ide_app::specta_builder().invoke_handler();
    builder
        .manage(WindowsState::default())
        .plugin(tauri_plugin_opener::init())
        // Files of plugins' web views, for their sandboxed frames.
        .register_asynchronous_uri_scheme_protocol(plugin_web::SCHEME, plugin_web::handle)
        .on_window_event(on_window_event)
        .invoke_handler(move |request: Invoke<Wry>| {
            if local_names.contains(request.message.command()) {
                return local(request);
            }
            let webview = request.message.webview_ref();
            if let Some(state) = webview.try_state::<AppState>() {
                if let Err(error) = state.host.authorize_command(webview.label(), request.message.command()) {
                    request.resolver.reject(error);
                    return true;
                }
            }
            upstream(request)
        })
}

/// Creates the backend state once the app exists. A failure leaves OmniTerm's own commands working.
pub(crate) fn setup(app: &mut tauri::App<Wry>) -> Result<(), Box<dyn Error>> {
    ide_app::specta_builder().mount_events(app);
    let identifier = app.config().identifier.clone();
    let local_data_dir = ide_host::data_dirs::local_data_dir(&identifier)?;
    // Managed LSP/DAP installs and JDKs must be on PATH before any language server starts.
    ide_tools::extend_process_path(&local_data_dir);
    ide_dap::adapter::set_tools_root(ide_tools::tools_dir(&local_data_dir));
    ide_sdk::java::add_jdk_root(&ide_tools::jdk::jdks_dir(&local_data_dir));
    let state = AppState::new(app.handle().clone(), local_data_dir)?;
    app.manage(state);
    commands::mcp::apply(&app.state::<AppState>());
    app.manage(ApplicationFocus::default());
    crate::builtin_plugins::install_missing(app.handle());
    Ok(())
}

/// Releases what the backend keeps per window when a window is destroyed.
pub(crate) fn on_window_event(window: &Window<Wry>, event: &WindowEvent) {
    if !matches!(event, WindowEvent::Destroyed) {
        return;
    }
    let label = window.label();
    if let Some(state) = window.try_state::<AppState>() {
        state.updates.forget_window(label);
        state.close_project(label);
        state.plugins.forget_client(label);
    }
    if let Some(windows) = window.try_state::<WindowsState>() {
        windows.forget(label);
    }
}

/// Stops what the backend started: child processes, MCP, notebooks.
pub(crate) fn on_exit(app: &tauri::AppHandle<Wry>) {
    if let Some(state) = app.try_state::<AppState>() {
        state.host.stop_processes_on_exit();
        commands::mcp::stop(&state);
        state.host.clear_workspace_edit_history_on_exit();
        state.host.shutdown_notebooks_on_exit();
    }
}

/// `pnpm gen:bindings`: regenerates `ui/ide/bindings.ts` from the IDE commands and IPC types.
/// A test of this crate, because only its binaries carry the Windows manifest Tauri needs to load.
#[cfg(test)]
mod bindings {
    #[test]
    #[ignore = "writes ui/ide/bindings.ts; run through `pnpm gen:bindings`"]
    fn gen_bindings() {
        ide_app::export_bindings(&ide_app::specta_builder());
    }
}
