---
id: component-rust-platform-plugins-settings
status: current
area: components-rust
navigation: "src-tauri platform/services"
platforms:
  - desktop
  - tauri
tags:
  - rust
  - plugins
  - settings
  - themes
  - window
  - rdp
related:
  - feature-plugin-lifecycle-runtime
  - feature-settings-themes-updates
  - feature-native-quick-shell
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Component Rust Platform Plugins Settings

## Description

Function-level catalog for settings/themes, plugin host/management, launchers, RDP, app utilities, shell probing and native window control.

## What

These modules own app/platform capabilities that need filesystem/process/Tauri handles but are outside workspace/PTY core.

## Why

Grouping their responsibilities documents the remaining native capability surface and its validation points.

## How

Each service exposes narrow commands/helpers: settings/theme app-data IO; plugin sidecar/RPC/lifecycle; generated launcher shims; RDP temp/client lifecycle; shell probes; logs/version; Tauri window actions.

## When

When settings/theme/plugin/native utility/RDP/shell/window features execute.

## Behavior

- Settings merge defaults with saved overrides.
- Theme/plugin/path identifiers validate before side effects.
- Launcher/RDP content is app-generated.

## Functionalities

- `default_shortcuts` / `defaults` — owned by this spec.
- `merge_shallow` / `read_settings` / `get_settings` / `save_settings` — owned by this spec.
- `list_themes` / `validate_theme_id` / `save_theme` / `delete_theme` — owned by this spec.
- `resolve_sidecar_script` — owned by this spec.
- `node_arg_path` / `disabled_descriptor` / `handle_reverse_call` — owned by this spec.
- `install_plugin_package` / `remove_plugin` / `restart_app` — owned by this spec.
- `launcher_bin_dir` / `setup_launcher` — owned by this spec.
- `generate_rdp_content` / `temp_file_name` / `sweep_stale_temp_files` / `connect_rdp` / `rdp_disconnect` — owned by this spec.
- `available_shells` / `list_available_shells` — owned by this spec.
- `reveal_log` / `clear_log` / `get_version` — owned by this spec.
- `minimize_window` / `set_webview_zoom` / `toggle_maximize` / `close_window` / `is_maximized` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `default_shortcuts` / `defaults` | Build settings defaults. | Stable configuration baseline. | Return default JSON/mapping. | Settings load. |
| `merge_shallow` / `read_settings` / `get_settings` / `save_settings` | Effective settings persistence. | Central preference service. | Merge defaults with app-data overrides and write changes. | Startup/settings edit. |
| `list_themes` / `validate_theme_id` / `save_theme` / `delete_theme` | Manage themes. | Safe appearance customization. | Validate IDs and operate custom theme files. | Theme actions. |
| `resolve_sidecar_script` | Resolve plugin host resource. | Controlled runtime entrypoint. | Packaged/dev resource resolution. | Plugin start. |
| `node_arg_path` / `disabled_descriptor` / `handle_reverse_call` | Plugin host API helpers. | Portable constrained plugin runtime. | Normalize path, model disabled state, explicit reverse dispatch. | Plugin RPC. |
| `install_plugin_package` / `remove_plugin` / `restart_app` | Plugin lifecycle. | Native package/app mutation. | Validated install/remove/restart flow. | Plugin actions. |
| `launcher_bin_dir` / `setup_launcher` | Manage launcher shims. | CLI integration. | Resolve app bin and write generated templates. | Launcher setup. |
| `generate_rdp_content` / `temp_file_name` / `sweep_stale_temp_files` / `connect_rdp` / `rdp_disconnect` | RDP lifecycle. | Native remote-desktop integration. | Generate controlled temp config, launch and clean up. | RDP actions. |
| `available_shells` / `list_available_shells` | Probe local shells. | Native executable truth. | Check supported executables and expose labels. | Shell selector. |
| `reveal_log` / `clear_log` / `get_version` | Diagnostics/app metadata. | Native utility UX. | Operate app-owned log/metadata. | Utility actions. |
| `minimize_window` / `set_webview_zoom` / `toggle_maximize` / `close_window` / `is_maximized` | Window control. | Desktop chrome/zoom. | Call Tauri window APIs. | Window actions. |

## State and data

- Settings/theme files
- Plugin process/RPC state
- Launcher paths
- RDP temp state
- Shell probe results
- Window state

## Errors and edge cases

- File/process/window/client/package failures return errors or explicit disabled states.

## Security and invariants

- Plugin reverse API explicit; URLs/paths validated; app-owned files only.

## Verification

- settings/theme/plugin/launcher/RDP/shell/window/app-utils tests

## Source map

- `src-tauri/src/settings.rs`
- `src-tauri/src/themes.rs`
- `src-tauri/src/plugin_host.rs`
- `src-tauri/src/plugin_host_api.rs`
- `src-tauri/src/plugin_management.rs`
- `src-tauri/src/launcher.rs`
- `src-tauri/src/rdp_embed.rs`
- `src-tauri/src/shell_probe.rs`
- `src-tauri/src/window_control.rs`
- `src-tauri/src/app_utils.rs`
