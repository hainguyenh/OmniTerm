---
id: component-rust-sessions-connections
status: current
area: components-rust
navigation: "src-tauri PTY/session/connection modules"
platforms:
  - desktop
  - tauri
tags:
  - rust
  - pty
  - sessions
  - connections
related:
  - feature-terminal-lifecycle
  - feature-connection-launch-secrets
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Component Rust Sessions Connections

## Description

Function-level catalog for live PTY ownership, connection resolution, output/status/activity, and connection persistence/import/export.

## What

Native code owns OS process/session handles and reusable connection storage; renderer communicates using IDs and structured models/events.

## Why

Processes and app-data files are native resources. Central ownership avoids renderer races, arbitrary executable selection, secret persistence, and process survival after app shutdown.

## How

PTY resolution looks up known connection/temporary IDs and builds launch details. The session daemon owns live PTYs and IO. Every GUI-launched PTY uses close-with-app lifetime. A GUI lease covers the app lifetime; losing it terminates every PTY owned by that GUI and lets the daemon exit when no owned sessions remain.

## When

On connection load/save/import/export and every terminal session start/IO/resize/status/stop/detach.

## Behavior

- Session operations require native-known IDs.
- Output order is preserved for live attach/detach operations.
- Saved connections exclude runtime passwords.
- `start_local_session` does not accept restart-recovery policy/generation context.
- Before a local PTY starts, a stale daemon session with the same stable ID is disconnected.
- New GUI PTYs are always created with generation 1 and `CloseWithApp`.
- Process state is not restored after app restart; renderer restart reconstruction launches a fresh shell using saved cwd metadata.
- `attach_existing_session` remains for live same-app detached-window attachment, not cross-app process recovery.

## Functionalities

- `resolve_connection_by_id` — owned by this spec.
- `resolve_local_launch` — owned by this spec.
- `prepare_ssh_session` — owned by this spec.
- `start_local_session` — owned by this spec.
- `send_session_input` — owned by this spec.
- `resize_session` — owned by this spec.
- `kill_session` / `disconnect_session` — owned by this spec.
- `attach_existing_session` — owned by this spec for same-app detached windows.
- daemon output/status streaming — owned by `session-core`.
- daemon process/activity polling — owned by `session-core`.
- `connections_path` — owned by this spec.
- `scrub_stored_secrets` — owned by this spec.
- `load_connections` / `save_connections` — owned by this spec.
- `parse_import_content` / `import_json` / `import_file` — owned by this spec.
- `export_json` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `resolve_connection_by_id` | Resolve known connection for launch. | Trusted identity lookup. | Search persisted/temp registry and dispatch by type. | Session open. |
| `resolve_local_launch` | Build local shell launch. | Central shell policy. | Resolve supported executable/cwd/env. | Local session. |
| `prepare_ssh_session` | Build SSH launch. | Native client validation. | Require client and construct args. | SSH session. |
| `start_local_session` | Start/register PTY. | Own native process. | Resolve launch, disconnect stale same-ID state, create close-with-app PTY, attach stream. | Session start/restart reconstruction. |
| `send_session_input` | Write PTY input. | Interactive terminal. | Lookup writer by session ID. | User input. |
| `resize_session` | Resize PTY. | Correct geometry. | Lookup session PTY and resize. | UI resize. |
| `kill_session` / `disconnect_session` | Terminate/release session. | Explicit lifecycle. | Lookup registry and clean process/runtime state. | Close/disconnect. |
| `attach_existing_session` | Attach to an existing live daemon PTY. | Support same-app detach/reattach without duplicate process. | Subscribe to runtime replay plus live output. | Detached window attach. |
| daemon output/status | Emit runtime replay plus live output/status. | Renderer updates without owning PTYs. | Buffer/publish by stable live session ID. | Runtime changes. |
| daemon activity poller | Derive activity metrics. | Session diagnostics/status. | Process-tree sampling plus OSC/input/output activity tracking. | Live session. |
| `connections_path` | Resolve global profile file. | One app-owned storage location. | App data path. | Connection load/save. |
| `scrub_stored_secrets` | Remove sensitive fields. | Prevent password persistence. | Transform records before serialization. | Save/export. |
| `load_connections` / `save_connections` | Read/write global profiles. | Durable reusable connections. | Parse/sanitize/serialize app-data JSON. | Startup/mutation. |
| `parse_import_content` / `import_json` / `import_file` | Import profiles. | Backup/transfer. | Parse structured JSON and produce outcome. | Import. |
| `export_json` | Export sanitized profiles. | Backup/share. | Serialize non-secret data. | Export. |

## State and data

- Live daemon session registry/PTY handles
- Daemon output/activity state
- GUI client lease
- Connection profile JSON
- Temporary runtime connection registry

Legacy daemon manifest/protocol fields may still be parsed for compatibility, but no user-facing persistence mode is configurable and new GUI sessions never use those modes.

## Errors and edge cases

- Unknown IDs, spawn/client, IO, or invalid import errors are explicit.
- GUI lease loss performs owned-session cleanup even if an old session record carries a legacy policy value.

## Security and invariants

- Renderer never receives raw process handles.
- Profile persistence scrubs secrets.
- Restart metadata cannot request a long-lived native process policy.

## Verification

- PTY bridge/session-core lifecycle and activity tests
- GUI lease-loss termination tests
- connection persistence/import tests
- password audit

## Source map

- `src-tauri/src/pty.rs`
- `crates/session-core/src/manager.rs`
- `src-tauri/src/pty_resolve.rs`
- `crates/session-core/src/output.rs`
- `crates/session-core/src/activity.rs`
- `crates/session-core/src/agent_activity.rs`
- `src-tauri/src/connections.rs`
