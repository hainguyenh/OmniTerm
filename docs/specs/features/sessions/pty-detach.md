---
id: feature-session-pty-detach
status: current
area: sessions
navigation: "Native PTY / Terminal > Detach"
platforms:
  - desktop
  - tauri
tags:
  - pty
  - session
  - window
  - detach
related:
  - architecture-windowing-layouts
  - feature-terminal-lifecycle
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Session Pty Detach

## Description

Defines native PTY ownership, output/activity processing and moving an existing session between main and detached windows.

## What

The out-of-process session daemon owns PTY/process handles and the live session registry; detachment changes presentation ownership only.

## Why

OS resources must survive renderer remounts and detaching must not create a duplicate process.

## How

PTY commands operate on stable daemon session IDs. The daemon buffers output and derives shell/agent-aware activity, while the Tauri bridge forwards its stream over existing renderer channels. `terminal_window` maps existing session IDs to detached windows and reattaches without restarting the PTY.

## When

On session start/input/resize/output/kill/disconnect and detach/reattach/focus.

## Behavior

- One native session per session ID.
- Detach preserves process/session identity.
- Replay is emitted before the live daemon stream, preserving output ordering across attach/restart.

## Functionalities

- `start_local_session` — owned by this spec.
- `send_session_input` — owned by this spec.
- `resize_session` — owned by this spec.
- `kill_session` / `disconnect_session` — owned by this spec.
- `list_local_sessions` / `set_session_persistence` — owned by this spec.
- daemon output/activity streaming — owned by `session-core`.
- `detach_terminal` — owned by this spec.
- `reattach_terminal` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `start_local_session` | Start native PTY. | Own process lifecycle. | Resolve launch, spawn/register IO loops. | Session start. |
| `send_session_input` | Write session input. | Interactive shell. | Lookup writer by session ID. | User input. |
| `resize_session` | Resize PTY. | Match UI geometry. | Lookup PTY and resize. | Pane/xterm resize. |
| `kill_session` / `disconnect_session` | Stop/release session. | Explicit lifecycle. | Lookup registry and terminate/release. | Close/disconnect. |
| `list_local_sessions` / `set_session_persistence` | Read/update daemon lifecycle state. | Restore and Hybrid lifetime policy. | Query or mutate sessiond records by stable session ID. | Startup/policy change. |
| daemon output/activity | Buffer replay and publish runtime state. | Keep PTY continuity independent of renderer lifetime. | `session-core` owns the 256 KiB replay tail plus ordinary-shell process polling and agent-aware OSC/input/output activity tracking with fresh local input forcing idle. | Live session. |
| `detach_terminal` | Create/focus detached renderer for existing session. | Move presentation without new PTY. | Bind session ID to Tauri window. | Detach. |
| `reattach_terminal` | Return session presentation to main app. | Reversible detach. | Release detached mapping and reattach. | Reattach. |

## State and data

- Daemon session registry
- Daemon-owned PTY handles
- Bounded replay plus durable recovery tail
- Daemon-owned activity metrics
- Window attachment map

## Errors and edge cases

- Unknown session/window, spawn/client or window creation errors are returned.

## Security and invariants

- Renderer cannot access raw process handles or arbitrary executable launch through session mutation APIs.

## Verification

- session-core persistence/replay/activity tests
- Tauri bridge and terminal_window tests

## Source map

- `src-tauri/src/pty.rs`
- `crates/session-core/src/manager.rs`
- `crates/session-core/src/output.rs`
- `crates/session-core/src/activity.rs`
- `crates/session-core/src/agent_activity.rs`
- `src-tauri/src/terminal_window.rs`
