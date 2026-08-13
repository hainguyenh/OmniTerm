---
id: feature-plugin-lifecycle-runtime
status: current
area: plugins
navigation: "Plugin Manager / runtime"
platforms:
  - desktop
  - tauri
tags:
  - plugins
  - sidecar
  - rpc
related:
  - architecture-security-data
  - component-rust-platform-plugins-settings
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Plugin Lifecycle Runtime

## Description

Defines plugin manager lifecycle plus controlled native host/sidecar and reverse-RPC behavior.

## What

Users can inspect/install/remove plugins; runtime plugins communicate through an explicit host protocol rather than unrestricted renderer/native execution.

## Why

Plugin package mutation and native capability access require a bounded, auditable native surface.

## How

`PluginManager` invokes native lifecycle commands. Plugin host resolves controlled sidecar resources, exchanges RPC, handles only approved reverse-call methods and gates external URL requests.

## When

When plugin manager opens, a plugin is installed/removed/restarted, or a plugin host sends/receives runtime RPC.

## Behavior

- Unsupported reverse calls are rejected.
- Disabled/unavailable plugin is explicit state.
- Restart is explicit when lifecycle change requires it.

## Functionalities

- `PluginManager` — owned by this spec.
- `install_plugin_package` — owned by this spec.
- `remove_plugin` — owned by this spec.
- `resolve_sidecar_script` — owned by this spec.
- `handle_reverse_call` — owned by this spec.
- `disabled_descriptor` — owned by this spec.
- `is_allowed_plugin_url` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `PluginManager` | Render descriptors/lifecycle actions. | User plugin control. | Consume plugin API and invoke actions. | Manager open. |
| `install_plugin_package` | Install plugin package. | Native filesystem/package ownership. | Validated install flow. | Install. |
| `remove_plugin` | Remove plugin. | Lifecycle cleanup. | Validated removal. | Remove. |
| `resolve_sidecar_script` | Resolve plugin host sidecar. | Controlled runtime entrypoint. | Resolve packaged/dev resource. | Plugin start. |
| `handle_reverse_call` | Dispatch approved plugin→app methods. | Constrain capabilities. | Explicit method/payload validation. | Reverse RPC. |
| `disabled_descriptor` | Represent unavailable plugin. | Graceful failure UI. | Return disabled metadata. | Host/plugin unavailable. |
| `is_allowed_plugin_url` | Validate external plugin URL. | Block unsafe target. | Apply URL policy. | Plugin asks to open URL. |

## State and data

- Plugin descriptors
- Install/remove status
- Sidecar/RPC state
- Pending calls

## Errors and edge cases

- Missing sidecar/package failures/unsupported methods return error or disabled state.

## Security and invariants

- No arbitrary reverse dispatch.
- URL/sidecar/package targets are validated natively.

## Verification

- Plugin management/host/API/RPC/integration tests
- App-utils URL tests

## Source map

- `ui/components/PluginManager.tsx`
- `src-tauri/src/plugin_management.rs`
- `src-tauri/src/plugin_host.rs`
- `src-tauri/src/plugin_host_api.rs`
