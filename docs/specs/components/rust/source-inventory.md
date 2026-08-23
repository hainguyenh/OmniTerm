---
id: component-rust-source-inventory
status: current
area: components-rust
navigation: "Rust/Tauri public function inventory"
platforms:
  - rust
  - tauri
tags:
  - rust
  - source-inventory
  - traceability
related:
  - component-rust-workspace-core
  - component-rust-workspace-tauri
  - component-rust-filesystem-launch
  - component-rust-sessions-connections
  - component-rust-platform-plugins-settings
properties:
  normative: true
  detail_level: public-function
  update_policy: code-and-spec-together
---
# Component Rust Source Inventory

## Description

Traceability inventory for every public or `pub(crate)` function in non-test top-level modules under `crates/app-core/src` and `src-tauri/src`. Detailed domain specs above explain exact invariants and workflows; this inventory prevents public native functions from being undocumented.

## What

Maps each public Rust function to its source module and a What / Why / How / When responsibility statement.

## Why

Native public functions form important internal or IPC capability surfaces. Explicit inventory makes architectural drift and undocumented new native behavior visible in review.

## How

The inventory follows current source declarations. Functions are described by their role while detailed feature/component specs define domain-specific semantics, errors and security boundaries.

## When

Update whenever a public or `pub(crate)` function is added, renamed, removed or changes ownership/responsibility.

## Behavior

- Every public function in the covered production modules appears by exact function name and source path.
- Test-only modules are excluded because verification behavior is documented in test suites/spec Verification sections.
- Private helpers are documented through their owning public function/module unless they represent a cross-domain invariant captured in another leaf spec.

## Functionalities

- Rust/Tauri public function traceability
- Native capability routing
- Documentation coverage gate

## Components and functions

| Function | What | Why | How | When |
|---|---|---|---|---|
| `resolve_launch`<br>`crates/app-core/src/launch.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `invocation`<br>`crates/app-core/src/launch.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `snapshot`<br>`crates/app-core/src/proc_activity.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `from_rows`<br>`crates/app-core/src/proc_activity.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `has_descendant`<br>`crates/app-core/src/proc_activity.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `descendants`<br>`crates/app-core/src/proc_activity.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `rdp_command`<br>`crates/app-core/src/rdp_launch.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `launch_rdp`<br>`crates/app-core/src/rdp_launch.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `system`<br>`src-tauri/src/os_actions.rs` | Construct a domain/runtime value | Keep system launch behavior behind a managed service | Build the production launcher state with the real OS implementation | During application setup |
| `test`<br>`src-tauri/src/os_actions.rs` | Construct a domain/runtime value | Keep tests isolated from user-facing OS actions | Build a no-op launcher state for test fixtures | During test fixture setup |
| `launch_rdp`<br>`src-tauri/src/os_actions.rs` | Initiate a native/runtime action | Keep OS/process/window behavior behind an injectable Tauri service | Resolve the selected action through the managed system or test launcher | On the matching user/runtime action |
| `open_folder`<br>`src-tauri/src/os_actions.rs` | Initiate a native/runtime action | Keep OS/process/window behavior behind an injectable Tauri service | Resolve the selected action through the managed system or test launcher | On the matching user/runtime action |
| `clamp_max_bytes`<br>`crates/app-core/src/safepath.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `canonical`<br>`crates/app-core/src/safepath.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `safe_editable_path`<br>`crates/app-core/src/safepath.rs` | Validate/authorize input or target | Centralize safety/invariant enforcement | Validate arguments/state and return an explicit result | Before the protected operation |
| `safe_runnable_path`<br>`crates/app-core/src/safepath.rs` | Validate/authorize input or target | Centralize safety/invariant enforcement | Validate arguments/state and return an explicit result | Before the protected operation |
| `safe_subdir`<br>`crates/app-core/src/safepath.rs` | Validate/authorize input or target | Centralize safety/invariant enforcement | Validate arguments/state and return an explicit result | Before the protected operation |
| `is_viewable_kind_excluding`<br>`crates/app-core/src/safepath.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `safe_viewable_path`<br>`crates/app-core/src/safepath.rs` | Validate/authorize input or target | Centralize safety/invariant enforcement | Validate arguments/state and return an explicit result | Before the protected operation |
| `safe_viewable_path_excluding`<br>`crates/app-core/src/safepath.rs` | Validate/authorize input or target | Centralize safety/invariant enforcement | Validate arguments/state and return an explicit result | Before the protected operation |
| `read_viewable`<br>`crates/app-core/src/safepath.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `read_viewable_excluding`<br>`crates/app-core/src/safepath.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `write_editable`<br>`crates/app-core/src/safepath.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `validate_tree`<br>`crates/app-core/src/tree_validate.rs` | Validate/authorize input or target | Centralize safety/invariant enforcement | Validate arguments/state and return an explicit result | Before the protected operation |
| `assign_new_job`<br>`crates/app-core/src/win_job.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `terminate`<br>`crates/app-core/src/win_job.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `script_run_request`<br>`crates/app-core/src/workspace_launch.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `default_shell`<br>`crates/app-core/src/workspace_launch.rs` | Construct a domain/runtime value | Keep construction rules consistent | Build the typed value from explicit inputs/defaults | When a new value/request is needed |
| `decode_workspaces`<br>`crates/app-core/src/workspace_model.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `validate_workspace_list`<br>`crates/app-core/src/workspace_model.rs` | Validate/authorize input or target | Centralize safety/invariant enforcement | Validate arguments/state and return an explicit result | Before the protected operation |
| `parse_workspace_import`<br>`crates/app-core/src/workspace_model.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `move_workspace`<br>`crates/app-core/src/workspace_model.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `normalize_workspace_orders`<br>`crates/app-core/src/workspace_model.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `set_entry_pinned`<br>`crates/app-core/src/workspace_model.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `rename_folder`<br>`crates/app-core/src/workspace_model.rs` | Mutate/persist controlled state | Centralize state changes and side effects behind the model layer | Trim, validate, and set a folder's display alias without touching path or id | When a user renames a workspace folder |
| 
ename_folder<br>`crates/app-core/src/workspace_model.rs` | Mutate/persist controlled state | Centralize state changes and side effects behind the model layer | Trim, validate, and set a folder's display alias without touching path or id | When a user renames a workspace folder |
| `is_entry_pinned`<br>`crates/app-core/src/workspace_model.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `logical_target`<br>`crates/app-core/src/workspace_model.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `namespace_path`<br>`crates/app-core/src/workspace_model.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `scan_dir`<br>`crates/app-core/src/workspace_scan.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `scan_dir_excluding`<br>`crates/app-core/src/workspace_scan.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `scan_entries`<br>`crates/app-core/src/workspace_scan.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `scan_entries_excluding`<br>`crates/app-core/src/workspace_scan.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `scan_folders`<br>`crates/app-core/src/workspace_scan.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `scan_folder_files_excluding`<br>`crates/app-core/src/workspace_scan_paging.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `scan_entries_page_excluding`<br>`crates/app-core/src/workspace_scan_paging.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `push`<br>`src-tauri/src/adhoc.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `mark_ready`<br>`src-tauri/src/adhoc.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `drain_if_ready`<br>`src-tauri/src/adhoc.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `new`<br>`src-tauri/src/adhoc.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `get`<br>`src-tauri/src/adhoc.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `insert_named`<br>`src-tauri/src/adhoc.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `renderer_connection`<br>`src-tauri/src/adhoc.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `open_adhoc_shell`<br>`src-tauri/src/adhoc.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `open_adhoc_shell_in_workspace`<br>`src-tauri/src/adhoc.rs` | Initiate a native/runtime action | Keep workspace-scoped OS/process/window behavior in Rust/Tauri | Resolve workspace context then invoke the native/runtime service | When a workspace script launches a shell |
| `flush_pending`<br>`src-tauri/src/adhoc.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `quick_shell_request`<br>`src-tauri/src/adhoc.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `open_quick_shell`<br>`src-tauri/src/adhoc.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `shells_ready`<br>`src-tauri/src/adhoc.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `shells_release`<br>`src-tauri/src/adhoc.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `is_allowed_plugin_url`<br>`src-tauri/src/app_utils.rs` | Validate/authorize input or target | Centralize safety/invariant enforcement | Validate arguments/state and return an explicit result | Before the protected operation |
| `reveal_log`<br>`src-tauri/src/app_utils.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `clear_log`<br>`src-tauri/src/app_utils.rs` | Remove/terminate/clean controlled state | Provide explicit lifecycle cleanup | Resolve owned target and remove/terminate it | On cleanup/delete/close |
| `get_version`<br>`src-tauri/src/app_utils.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `open_in_system`<br>`src-tauri/src/app_utils.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `connections_path`<br>`src-tauri/src/connections.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `read_tree`<br>`src-tauri/src/connections.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `scrub_stored_secrets`<br>`src-tauri/src/connections.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `load_connections`<br>`src-tauri/src/connections.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `save_connections`<br>`src-tauri/src/connections.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `parse_import_content`<br>`src-tauri/src/connections.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `import_outcome_to_value`<br>`src-tauri/src/connections.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `export_json`<br>`src-tauri/src/connections.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `import_json`<br>`src-tauri/src/connections.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `import_file`<br>`src-tauri/src/connections.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `custom_art_dir`<br>`src-tauri/src/custom_art.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `upload_custom_art_impl`<br>`src-tauri/src/custom_art.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `get_custom_art_impl`<br>`src-tauri/src/custom_art.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `remove_custom_art_impl`<br>`src-tauri/src/custom_art.rs` | Remove/terminate/clean controlled state | Provide explicit lifecycle cleanup | Resolve owned target and remove/terminate it | On cleanup/delete/close |
| `upload_custom_art`<br>`src-tauri/src/custom_art.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `get_custom_art`<br>`src-tauri/src/custom_art.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `remove_custom_art`<br>`src-tauri/src/custom_art.rs` | Remove/terminate/clean controlled state | Provide explicit lifecycle cleanup | Resolve owned target and remove/terminate it | On cleanup/delete/close |
| `launcher_bin_dir`<br>`src-tauri/src/launcher.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `nc_open_contents`<br>`src-tauri/src/launcher.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `wt_cmd_contents`<br>`src-tauri/src/launcher.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `wt_shim_contents`<br>`src-tauri/src/launcher.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `setup_launcher`<br>`src-tauri/src/launcher.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `run`<br>`src-tauri/src/lib.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `resolve_sidecar_script`<br>`src-tauri/src/plugin_host.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `new`<br>`src-tauri/src/plugin_host.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `start`<br>`src-tauri/src/plugin_host.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `node_arg_path`<br>`src-tauri/src/plugin_host_api.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `disabled_descriptor`<br>`src-tauri/src/plugin_host_api.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `handle_reverse_call`<br>`src-tauri/src/plugin_host_api.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `is_available`<br>`src-tauri/src/plugin_host_rpc.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `list_plugins`<br>`src-tauri/src/plugin_host_rpc.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `set_enabled`<br>`src-tauri/src/plugin_host_rpc.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `select_connection_provider`<br>`src-tauri/src/plugin_host_rpc.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `connection_capabilities`<br>`src-tauri/src/plugin_host_rpc.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `uninstall`<br>`src-tauri/src/plugin_host_rpc.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `invoke`<br>`src-tauri/src/plugin_host_rpc.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `auth_gate`<br>`src-tauri/src/plugin_host_rpc.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `load_connections`<br>`src-tauri/src/plugin_host_rpc.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `save_connections`<br>`src-tauri/src/plugin_host_rpc.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `resolve_connection`<br>`src-tauri/src/plugin_host_rpc.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `load_scoped_connections`<br>`src-tauri/src/plugin_host_rpc.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `save_scoped_connections`<br>`src-tauri/src/plugin_host_rpc.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `resolve_scoped_connection`<br>`src-tauri/src/plugin_host_rpc.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `resolve_connection_launch`<br>`src-tauri/src/plugin_host_rpc.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `install_plugin_package`<br>`src-tauri/src/plugin_management.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `remove_plugin`<br>`src-tauri/src/plugin_management.rs` | Remove/terminate/clean controlled state | Provide explicit lifecycle cleanup | Resolve owned target and remove/terminate it | On cleanup/delete/close |
| `restart_app`<br>`src-tauri/src/plugin_management.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `new`<br>`src-tauri/src/pty.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `configure`<br>`src-tauri/src/pty.rs` | Configure the GUI client for sessiond | Keep daemon endpoint/executable discovery inside the native boundary | Resolve app-data state directory, current executable, and start the client lease | During Tauri setup or first session action |
| `client`<br>`src-tauri/src/pty.rs` | Return the configured sessiond client | Centralize daemon-client availability errors | Clone the initialized client or return an explicit initialization error | Before native session IPC |
| `colorfgbg_for_dark_mode`<br>`src-tauri/src/pty.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `start_local_session`<br>`src-tauri/src/pty.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `send_session_input`<br>`src-tauri/src/pty.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `resize_session`<br>`src-tauri/src/pty.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `kill_session`<br>`src-tauri/src/pty.rs` | Remove/terminate/clean controlled state | Provide explicit lifecycle cleanup | Resolve owned target and remove/terminate it | On cleanup/delete/close |
| `disconnect_session`<br>`src-tauri/src/pty.rs` | Remove/terminate/clean controlled state | Provide explicit lifecycle cleanup | Resolve owned target and remove/terminate it | On cleanup/delete/close |
| `list_local_sessions`<br>`src-tauri/src/pty.rs` | Read daemon-owned PTY lifecycle summaries | Let renderer restore live sessions before any cold launch | Query sessiond and refresh the Tauri-side metadata cache | During startup restore and persistence snapshots |
| `set_session_persistence`<br>`src-tauri/src/pty.rs` | Mutate a terminal persistence policy | Keep Hybrid policy authoritative in the daemon | Validate the wire policy and update the daemon-owned session record | When user/default policy changes |
| `attach_existing_session`<br>`src-tauri/src/pty.rs` | Attach a renderer/window to an existing daemon PTY | Reuse the same process after GUI restart or detach/reattach | Subscribe to daemon replay plus live output without spawning a PTY | When restoring a live session or terminal window |
| `require_windows_client`<br>`src-tauri/src/pty_resolve.rs` | Validate/authorize input or target | Centralize safety/invariant enforcement | Validate arguments/state and return an explicit result | Before the protected operation |
| `require_windows_client`<br>`src-tauri/src/pty_resolve.rs` | Validate/authorize input or target | Centralize safety/invariant enforcement | Validate arguments/state and return an explicit result | Before the protected operation |
| `native_batch_launch`<br>`src-tauri/src/pty_resolve.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `prepare_ssh_session`<br>`src-tauri/src/pty_resolve.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `resolve_connection_by_id`<br>`src-tauri/src/pty_resolve.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `resolve_local_launch`<br>`src-tauri/src/pty_resolve.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `new`<br>`src-tauri/src/rdp_embed.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `register`<br>`src-tauri/src/rdp_embed.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `remove`<br>`src-tauri/src/rdp_embed.rs` | Remove/terminate/clean controlled state | Provide explicit lifecycle cleanup | Resolve owned target and remove/terminate it | On cleanup/delete/close |
| `generate_rdp_content`<br>`src-tauri/src/rdp_embed.rs` | Construct a domain/runtime value | Keep construction rules consistent | Build the typed value from explicit inputs/defaults | When a new value/request is needed |
| `temp_file_name`<br>`src-tauri/src/rdp_embed.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `sweep_stale_temp_files`<br>`src-tauri/src/rdp_embed.rs` | Remove/terminate/clean controlled state | Provide explicit lifecycle cleanup | Resolve owned target and remove/terminate it | On cleanup/delete/close |
| `connect_rdp`<br>`src-tauri/src/rdp_embed.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `rdp_disconnect`<br>`src-tauri/src/rdp_embed.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `system_excluded_view_exts`<br>`src-tauri/src/safepath_command.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `default_shortcuts`<br>`src-tauri/src/settings.rs` | Construct a domain/runtime value | Keep construction rules consistent | Build the typed value from explicit inputs/defaults | When a new value/request is needed |
| `defaults`<br>`src-tauri/src/settings.rs` | Construct a domain/runtime value | Keep construction rules consistent | Build the typed value from explicit inputs/defaults | When a new value/request is needed |
| `merge_shallow`<br>`src-tauri/src/settings.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `read_settings`<br>`src-tauri/src/settings.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `get_settings`<br>`src-tauri/src/settings.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `save_settings`<br>`src-tauri/src/settings.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `available_shells`<br>`src-tauri/src/shell_probe.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `available_shells`<br>`src-tauri/src/shell_probe.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `list_available_shells`<br>`src-tauri/src/shell_probe.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `new`<br>`src-tauri/src/terminal_window.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `begin_shutdown`<br>`src-tauri/src/terminal_window.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `detach_terminal`<br>`src-tauri/src/terminal_window.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `bootstrap_terminal_window`<br>`src-tauri/src/terminal_window.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `attach_session`<br>`src-tauri/src/terminal_window.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `reattach_terminal`<br>`src-tauri/src/terminal_window.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `focus_terminal_window`<br>`src-tauri/src/terminal_window.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `release_terminal_window`<br>`src-tauri/src/terminal_window.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `list_themes`<br>`src-tauri/src/themes.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `validate_theme_id`<br>`src-tauri/src/themes.rs` | Validate/authorize input or target | Centralize safety/invariant enforcement | Validate arguments/state and return an explicit result | Before the protected operation |
| `save_theme`<br>`src-tauri/src/themes.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `delete_theme`<br>`src-tauri/src/themes.rs` | Remove/terminate/clean controlled state | Provide explicit lifecycle cleanup | Resolve owned target and remove/terminate it | On cleanup/delete/close |
| `open_themes_folder`<br>`src-tauri/src/themes.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `minimize_window`<br>`src-tauri/src/window_control.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `set_webview_zoom`<br>`src-tauri/src/window_control.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `toggle_maximize`<br>`src-tauri/src/window_control.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `close_window`<br>`src-tauri/src/window_control.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `is_maximized`<br>`src-tauri/src/window_control.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `find_workspace`<br>`src-tauri/src/workspace.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `list_workspaces`<br>`src-tauri/src/workspace.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `create_workspace`<br>`src-tauri/src/workspace.rs` | Construct a domain/runtime value | Keep construction rules consistent | Build the typed value from explicit inputs/defaults | When a new value/request is needed |
| `add_workspace`<br>`src-tauri/src/workspace.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `add_workspace_folder`<br>`src-tauri/src/workspace_folders.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `canonical_dir`<br>`src-tauri/src/workspace_folders.rs` | Validate/authorize input or target | Centralize safety/invariant enforcement at boundaries | Canonicalize the path and require an existing directory before persistence | When a folder is attached to a workspace |
| `new_folder`<br>`src-tauri/src/workspace_folders.rs` | Construct a domain/runtime value | Keep construction rules consistent | Build the typed record with generated id, basename display name, and no color | When a workspace gains a folder root |
| `remove_workspace_folder`<br>`src-tauri/src/workspace_folders.rs` | Remove/terminate/clean controlled state | Provide explicit lifecycle cleanup | Resolve owned target and remove/terminate it | On cleanup/delete/close |
| `rename_workspace_folder`<br>`src-tauri/src/workspace_folders.rs` | Mutate/persist controlled state | Keep folder identity stable while display names change | Trim/validate the alias, update the persisted folder record, return the workspace | When a user renames a workspace folder from the tree | 
| `import_workspace_file`<br>`src-tauri/src/workspace.rs` | Parse/translate/resolve data | Centralize boundary/transformation semantics | Convert validated inputs into the domain/native representation | When crossing a model/launch/import boundary |
| `remove_workspace`<br>`src-tauri/src/workspace.rs` | Remove/terminate/clean controlled state | Provide explicit lifecycle cleanup | Resolve owned target and remove/terminate it | On cleanup/delete/close |
| `rename_workspace`<br>`src-tauri/src/workspace.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `move_workspace`<br>`src-tauri/src/workspace.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `set_workspace_entry_pinned`<br>`src-tauri/src/workspace.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `scan_scripts`<br>`src-tauri/src/workspace.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `scan_workspace_folders`<br>`src-tauri/src/workspace.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `scan_workspace_entries`<br>`src-tauri/src/workspace.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `run_script`<br>`src-tauri/src/workspace.rs` | Initiate a native/runtime action | Keep OS/process/window behavior in Rust/Tauri | Resolve validated inputs then invoke the native/runtime service | On the matching user/runtime action |
| `read_script`<br>`src-tauri/src/workspace.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `write_script`<br>`src-tauri/src/workspace.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `set_workspace_appearance`<br>`src-tauri/src/workspace_appearance.rs` | Mutate/persist controlled state | Centralize workspace presentation metadata | Validate allowed color/icon keys, update the saved workspace, and return the persisted record | On workspace appearance changes |
| `set_workspace_folder_color`<br>`src-tauri/src/workspace_appearance.rs` | Mutate/persist controlled state | Centralize root-folder presentation metadata | Validate the color key, update the matching saved folder, and return the persisted workspace | On root-folder color changes |
| `normalize_appearance_value`<br>`src-tauri/src/workspace_appearance.rs` | Validate/authorize input or target | Centralize allowed appearance values | Normalize case and whitespace, then reject unsupported keys | Before persisting appearance metadata |
| `read_at`<br>`src-tauri/src/workspace_connections.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `find_by_id`<br>`src-tauri/src/workspace_connections.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `load_workspace_connections`<br>`src-tauri/src/workspace_connections.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `save_workspace_connections`<br>`src-tauri/src/workspace_connections.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |
| `delete_workspace_connection`<br>`src-tauri/src/workspace_connections.rs` | Remove/terminate/clean controlled state | Provide explicit lifecycle cleanup | Resolve owned target and remove/terminate it | On cleanup/delete/close |
| `workspaces_file`<br>`src-tauri/src/workspace_persistence.rs` | Expose module behavior | Provide the module’s public/native capability | Execute the implementation in the owning Rust module with explicit inputs/results | When invoked by its caller/IPC flow |
| `read_workspaces`<br>`src-tauri/src/workspace_persistence.rs` | Read/derive runtime or persisted data | Provide authoritative data to callers | Resolve state/path and return a typed value/result | On query/load/scan |
| `write_workspaces`<br>`src-tauri/src/workspace_persistence.rs` | Mutate/persist controlled state | Centralize state changes and side effects | Validate/resolve target then perform the mutation | On a state-changing action |

## State and data

- Inventory contains documentation metadata only; runtime/persisted state is owned by the referenced modules.

## Errors and edge cases

- Conditional-platform functions can appear more than once in source but one inventory row/name is sufficient for traceability.
- New public functions fail the documentation coverage test until represented here.

## Security and invariants

- Public function presence is not permission: native callers still enforce each owning feature’s validation/security spec.
- Renderer-native capability remains limited to registered Tauri commands, not every public Rust helper.

## Verification

- `scripts/__tests__/spec-docs.test.mjs` enumerates public Rust function declarations and requires exact names and module paths in this inventory.

## Source map

- `crates/app-core/src`
- `src-tauri/src`
