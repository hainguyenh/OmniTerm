#[path = "agent_quota/agent_quota.rs"]
pub mod agent_quota;
pub mod agent_session;
mod agent_session_cleanup;
#[path = "always_awake/always_awake.rs"]
pub mod always_awake;
mod app_utils;
pub use app_utils::handle_second_instance;
mod attachments;
mod launcher;
mod os_actions;
mod plugin_commands;
pub use plugin_commands::*;
mod settings;
mod settings_transfer;
mod themes;
mod update_coordinator;
mod update_manager;
mod update_progress;
mod window_control;

mod app_state;
mod builtin_features;
mod builtin_plugins;
#[cfg(test)]
mod command_coverage_tests;
pub mod ide;
mod idea_host;
mod invoke_handlers;
#[cfg(test)]
use invoke_handlers::with_invoke_handler;
#[cfg(test)]
mod ipc_contract_tests;
mod temp_note_commands;
#[cfg(test)]
mod test_support;
mod workspace_file_commands;

// Public so integration tests under tests/ can drive launch and command paths.
pub mod adhoc;
pub mod connections;
pub use app_protocol::{openshell, session_status, shell_spec};

#[cfg(windows)]
pub use app_core::win_job;
pub use app_core::{launch, proc_activity, rdp_launch, tree_validate, workspace_launch};
pub mod pty;
mod pty_interrupt;
mod pty_lease;
pub mod pty_resolve;
mod pty_status;
pub mod safepath_command;
pub use app_core::safepath;
pub use app_core::workspace_scan;
pub mod custom_art;
pub mod rdp_embed;
pub mod shell_probe;
pub mod terminal_window;
pub mod workspace;
pub mod workspace_appearance;
pub mod workspace_connections;
pub mod workspace_folders;
pub mod workspace_lifecycle;
mod workspace_persistence;

use agent_quota::AgentQuotaState;
// Only the command tests name these through `use super::*`; the state itself is registered in `app_state`.
#[cfg(test)]
use adhoc::AdhocRegistry;
use always_awake::AlwaysAwakeState;
use pty::PtyManager;
#[cfg(test)]
use rdp_embed::RdpSessionManager;
use tauri::{Emitter, Manager, RunEvent};
use terminal_window::DetachRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let smoke_test = std::env::args().any(|a| a == "--coverage-smoke");
    let builder = tauri::Builder::default()
        // The single-instance plugin must be registered first so a second launch is forwarded before
        // any other plugin has a chance to initialize against a duplicate instance.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            app_utils::handle_second_instance(app, &argv);
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init());
    // Native updater. The plugin REQUIRES a valid `plugins.updater` object at initialization —
    // registered unconditionally it panics every build whose conf lacks one ("invalid type: null").
    // Release builds inject that config via scripts/configure-tauri-updater.mjs from
    // OMNITERM_UPDATER_PUBKEY, so gate on the same variable: set here means the configure step ran
    // and the merged config carries real endpoints. Without it the updater commands still answer
    // with their typed "updater-disabled" results (update_manager.rs).
    let updater = std::env::var_os("OMNITERM_UPDATER_PUBKEY").is_some();
    let builder = if updater {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    } else {
        builder
    };
    let builder = builder.manage(update_manager::UpdaterRegistered(updater));
    let builder = app_state::manage_state(builder)
        .manage(os_actions::ExternalLauncherState::system())
        .setup(move |app| {
            // The embedded omniterm backend; its failure must not take OmniTerm's own commands down.
            if let Err(error) = idea_host::setup(app) {
                log::error!("[setup] omniterm backend did not start: {error}");
            }
            // Logging is a development-only facility. `#[cfg]` (not `cfg!`) so the registration is
            // not even compiled into a release or portable build: nothing installs a logger, so no
            // log directory is created and no line is ever written to disk. Cargo.toml's
            // `release_max_level_off` closes the other half — the `log::*!` call sites themselves
            // compile away — so the two together mean a packaged build has no log to deny access to.
            #[cfg(debug_assertions)]
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Trace)
                    // The embedded IDE backend compiles WebAssembly plugins and talks to language
                    // servers; at trace level their libraries write gigabytes per minute.
                    .level_for("cranelift_codegen", log::LevelFilter::Warn)
                    .level_for("cranelift_frontend", log::LevelFilter::Warn)
                    .level_for("wasmtime", log::LevelFilter::Warn)
                    .level_for("wasmtime_internal_cranelift", log::LevelFilter::Warn)
                    .level_for("wasmtime_internal_cache", log::LevelFilter::Warn)
                    .level_for("regalloc2", log::LevelFilter::Warn)
                    .level_for("wasmparser", log::LevelFilter::Warn)
                    .level_for("gix", log::LevelFilter::Info)
                    .level_for("globset", log::LevelFilter::Info)
                    .level_for("ignore", log::LevelFilter::Info)
                    .level_for("notify", log::LevelFilter::Info)
                    .level_for("mio", log::LevelFilter::Info)
                    .level_for("tao", log::LevelFilter::Info)
                    .build(),
            )?;

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

            // The out-of-process session daemon owns PTYs and their activity polling. This GUI keeps
            // a lease only so `close-with-app` sessions can be reaped when the client disappears.
            if let Err(error) = app.state::<PtyManager>().configure(app.handle()) {
                log::warn!("[setup] session daemon client did not initialize: {error}");
            }
            // Always Awake starts its own poller on the plugin's first `get_state`, so a build with
            // the plugin absent never runs it. See always_awake::ensure_poller.

            // This launch may itself carry --open-shell (the shim can start a cold instance).
            let handle = app.handle().clone();
            let argv: Vec<String> = std::env::args().collect();
            if let Some(req) = openshell::parse_open_shell_args(&argv) {
                adhoc::open_adhoc_shell(&handle, req);
            }

            // Coverage smoke mode: boot the real (Wry) window, let setup finish, then exit
            // cleanly. The coverage gate's function metric counts every instantiation, including
            // the binary-only Wry copies of each #[tauri::command] that only exist when the app
            // itself runs; launching the real binary under instrumentation covers them without
            // needing a display-visible session or any user interaction.
            if smoke_test {
                std::thread::spawn(|| {
                    std::thread::sleep(std::time::Duration::from_millis(1200));
                    // std::process::exit (not the handle.exit tauri event-loop exit) so the linked
                    // LLVM profile runtime's atexit flush runs and the profraw is written.
                    std::process::exit(0);
                });
            }

            Ok(())
        });

    idea_host::attach(builder)
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Quitting closes every window, including detached ones. Latch that first, or each
            // detached window's Destroyed handler runs its kill-or-fold branch on the way out —
            // reaping sessions during teardown and emitting fold-back events at a main window that
            // is itself closing.
            if matches!(event, RunEvent::Exit) {
                // Runs, terminals, language servers and debug sessions of the workbench must not
                // outlive the app.
                idea_host::on_exit(app);
            }
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                if let Some(pty) = app.try_state::<PtyManager>() {
                    // Do not let the GUI lease retry loop respawn a daemon while the process is
                    // already leaving; the daemon will stop itself after applying session policy.
                    pty.begin_shutdown();
                }
                if let Some(registry) = app.try_state::<DetachRegistry>() {
                    registry.begin_shutdown();
                }
                // Always Awake must not outlive the app. The kernel would drop the sleep request
                // when the process dies anyway, but only the poller thread can hand it back
                // deliberately (SetThreadExecutionState is thread-affine), so ask it to now.
                if let Some(awake) = app.try_state::<AlwaysAwakeState>() {
                    awake.begin_shutdown();
                }
                // A quota-suspended agent must never outlive the window that could resume it.
                if let Some(quota) = app.try_state::<AgentQuotaState>() {
                    quota.resume_all();
                }
            }
        });
}
