---
id: component-rust-workspace-tauri
status: current
area: components-rust
navigation: "src-tauri workspace modules"
platforms:
  - desktop
  - tauri
tags:
  - rust
  - tauri
  - workspace
  - ipc
related:
  - component-rust-workspace-core
  - contract-ipc-persistence
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Component Rust Workspace Tauri

## Description

Function-level catalog for Tauri workspace commands, app-data persistence and workspace-project connection storage.

## What

This layer owns AppHandle, selected native paths, command entrypoints and persistence side effects while delegating domain rules to app-core.

## Why

Keeping Tauri thin avoids duplicate model logic and makes native capability boundaries obvious.

## How

Commands load validated workspaces, canonicalize user-selected roots, delegate model/scanning/safepath helpers, persist mutations and return protocol models. Shared protocol types are imported by Rust library crate name `app_protocol`.

## When

Every renderer workspace IPC call and persisted workspace load/save.

## Behavior

- Mutation response follows successful persistence.
- Legacy load rewrites current schema.
- Composite container is never used as fake filesystem root.

## Functionalities

- `list_workspaces` — owned by this spec.
- `create_workspace` — owned by this spec.
- `add_workspace` — owned by this spec.
- `add_workspace_folder` — owned by this spec.
- `import_workspace_file` — owned by this spec.
- `remove_workspace` — owned by this spec.
- `move_workspace` — owned by this spec.
- `set_workspace_entry_pinned` — owned by this spec.
- `scan_scripts` — owned by this spec.
- `scan_workspace_folders` — owned by this spec.
- `scan_workspace_entries` — owned by this spec.
- `run_script` — owned by this spec.
- `read_script` — owned by this spec.
- `write_script` — owned by this spec.
- `read_workspaces` / `write_workspaces` — owned by this spec.
- `load/save/delete_workspace_connection` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `list_workspaces` | Return authoritative workspace list. | Renderer startup/refresh. | Read persistence with migration. | List/load. |
| `create_workspace` | Create empty container. | Workspace may organize children before folders. | Trim name, assign ID/root order, save. | New Workspace. |
| `add_workspace` | Create one-folder workspace. | Fast folder-as-workspace flow. | Canonicalize/dedupe path, create/save. | Add workspace folder picker. |
| `add_workspace_folder` | Attach root to existing workspace. | Composite multi-root support. | Canonicalize, find/dedupe, generate folder ID, save. | Add Folder. |
| `import_workspace_file` | Import editor workspace. | Reuse existing multi-root grouping. | Bound read, parse core import, regenerate IDs, save. | Import. |
| `remove_workspace` | Remove container only. | Do not delete child data/files. | Promote children, remove record, normalize/save. | Remove workspace. |
| `move_workspace` | Persist hierarchy/order. | Durable user organization. | Delegate core move, write, return list. | Drag/keyboard move. |
| `set_workspace_entry_pinned` | Persist pin state. | Durable pinned ordering. | Delegate core pin update and save. | Pin/unpin. |
| `scan_scripts` | Aggregate scripts across roots. | Composite discovery. | Scan each root and namespace results. | Refresh scripts. |
| `scan_workspace_folders` | Return root/skeleton tree entries. | Named multi-root tree. | Emit synthetic folder roots plus namespaced dirs. | Workspace tree load. |
| `scan_workspace_entries` | Page one logical folder. | Bound scoped IO. | Resolve target, scan page, namespace entries. | Expand/show more. |
| `run_script` | Run script/RDP or open folder terminal. | Workspace execution. | Resolve safe target/cwd and invoke launch. | Run/Open Terminal. |
| `read_script` | Read viewable logical file. | Viewer/editor. | Resolve target and bounded safe read. | Open. |
| `write_script` | Write editable logical file. | Editor save. | Resolve target and safe write. | Save. |
| `read_workspaces` / `write_workspaces` | Persist validated workspace state. | One durable source. | Decode/migrate or validate/serialize app data. | Any load/mutation. |
| `load/save/delete_workspace_connection` | Manage project connections. | Workspace-scoped profile portability. | Resolve real folder `.omniterm` storage. | Workspace connection action. |

## State and data

- AppHandle
- workspaces.json
- Workspace list
- Workspace folder roots
- Settings safety policy
- Project connection JSON

## Errors and edge cases

- Unknown workspace/folder, import/IO/persistence failures return errors and do not persist invalid state.

## Security and invariants

- Direct selected paths are canonicalized.
- Logical paths are resolved before safepath operations.
- Protocol imports use `app_protocol`, not Cargo package identifier.

## Verification

- workspace command/IPC/persistence/connection tests
- scripts/__tests__/rust-crate-imports.test.mjs

## Source map

- `src-tauri/src/workspace.rs`
- `src-tauri/src/workspace_persistence.rs`
- `src-tauri/src/workspace_connections.rs`
