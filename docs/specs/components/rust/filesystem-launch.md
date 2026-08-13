---
id: component-rust-filesystem-launch
status: current
area: components-rust
navigation: "app-core safepath / launch"
platforms:
  - desktop
  - tauri
tags:
  - rust
  - filesystem
  - security
  - launch
related:
  - architecture-security-data
  - feature-workspace-operations
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Component Rust Filesystem Launch

## Description

Function-level catalog for canonical filesystem containment, bounded read/write and process/RDP launch request construction.

## What

These core functions turn validated logical intent into safe real filesystem/process targets.

## Why

One shared native safety layer prevents brittle string-prefix path checks and duplicated file/run policies.

## How

Canonical root/target identity enforces containment. File capabilities/exclusions/limits gate view/edit/run. Launch helpers build structured shell/RDP/process requests from authorized paths.

## When

Before workspace file read/write/run, terminal cwd, local process launch or RDP launch.

## Behavior

- Canonical containment, not raw prefix matching.
- View/edit/run are distinct capabilities.
- Configured max bytes is bounded.

## Functionalities

- `clamp_max_bytes` — owned by this spec.
- `canonical` — owned by this spec.
- `safe_editable_path` — owned by this spec.
- `safe_runnable_path` — owned by this spec.
- `safe_subdir` — owned by this spec.
- `safe_viewable_path_excluding` — owned by this spec.
- `read_viewable_excluding` — owned by this spec.
- `write_editable` — owned by this spec.
- `resolve_launch` — owned by this spec.
- `script_run_request` — owned by this spec.
- `default_shell` — owned by this spec.
- `rdp_command` / `launch_rdp` — owned by this spec.
- `assign_new_job` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `clamp_max_bytes` | Clamp configured open size. | Bound resource usage. | Apply allowed size range/default. | Read/write policy. |
| `canonical` | Canonicalize path. | Resolve traversal/symlink identity. | Filesystem canonicalization with error. | Safe path operation. |
| `safe_editable_path` | Authorize editable target. | Protect writes. | Containment + editable-kind check. | Save. |
| `safe_runnable_path` | Authorize runnable target. | Protect execution. | Containment + runnable-kind check. | Run. |
| `safe_subdir` | Authorize directory cwd. | Protect terminal cwd. | Canonicalize root+relative and ensure contained directory. | Open terminal. |
| `safe_viewable_path_excluding` | Authorize viewable target with exclusions. | Protect reads/policy. | Containment + kind + excluded extension. | Open file. |
| `read_viewable_excluding` | Read bounded safe text. | Single safe read boundary. | Resolve target, enforce max bytes, read text. | Viewer. |
| `write_editable` | Write bounded safe text. | Single safe write boundary. | Resolve editable target, enforce size, write. | Editor save. |
| `resolve_launch` | Resolve process launch spec. | Tauri-free launch rules. | Validate/build executable args/cwd. | Session start. |
| `script_run_request` | Build workspace script request. | Central script kind/shell semantics. | Map script info to OpenShellRequest. | Workspace run. |
| `default_shell` | Choose default shell identifier. | Consistent folder terminal. | Platform-aware closed choice. | Open Terminal. |
| `rdp_command` / `launch_rdp` | Build/launch RDP. | Dedicated RDP execution. | Validate config path and start native client. | RDP action. |
| `assign_new_job` | Assign Windows process to job. | Clean child process lifecycle. | Windows job object assignment. | Windows spawn. |

## State and data

- Canonical roots/targets
- File kind/extensions
- Safety settings
- Launch request

## Errors and edge cases

- Missing/traversal/disallowed/oversize targets and unavailable executable/client return explicit errors.

## Security and invariants

- Primary native filesystem/process authorization boundary.

## Verification

- safepath/view tests
- launch/workspace_launch/RDP tests
- platform job tests

## Source map

- `crates/app-core/src/safepath.rs`
- `crates/app-core/src/launch.rs`
- `crates/app-core/src/workspace_launch.rs`
- `crates/app-core/src/rdp_launch.rs`
- `crates/app-core/src/win_job.rs`
