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

Native runtime owns process handles and session registry; detachment changes presentation ownership only.

## Why

OS resources must survive renderer remounts and detaching must not create a duplicate process.

## How

PTY commands operate on native session IDs. Output/status/activity helpers emit events. `terminal_window` maps existing session IDs to detached windows and reattaches them without restarting the PTY.

## When

On session start/input/resize/output/kill/disconnect and detach/reattach/focus.

## Behavior

- One native session per session ID.
- Detach preserves process/session identity.
- Output ordering is preserved through batching.

## Functionalities

- `start_local_session` — owned by this spec.
- `send_session_input` — owned by this spec.
- `resize_session` — owned by this spec.
- `kill_session` / `disconnect_session` — owned by this spec.
- `push_output` / `send_status` — owned by this spec.
- `spawn_poller` — owned by this spec.
- `detach_terminal` — owned by this spec.
- `reattach_terminal` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `start_local_session` | Start native PTY. | Own process lifecycle. | Resolve launch, spawn/register IO loops. | Session start. |
| `send_session_input` | Write session input. | Interactive shell. | Lookup writer by session ID. | User input. |
| `resize_session` | Resize PTY. | Match UI geometry. | Lookup PTY and resize. | Pane/xterm resize. |
| `kill_session` / `disconnect_session` | Stop/release session. | Explicit lifecycle. | Lookup registry and terminate/release. | Close/disconnect. |
| `push_output` / `send_status` | Emit runtime stream/status. | Renderer updates. | Batch/publish events by session. | Output/status changes. |
| `spawn_poller` | Poll process activity. | Metrics/status. | Background activity sampling. | Live session. |
| `detach_terminal` | Create/focus detached renderer for existing session. | Move presentation without new PTY. | Bind session ID to Tauri window. | Detach. |
| `reattach_terminal` | Return session presentation to main app. | Reversible detach. | Release detached mapping and reattach. | Reattach. |

## State and data

- Session registry
- PTY handles
- Output buffers
- Activity metrics
- Window attachment map

## Errors and edge cases

- Unknown session/window, spawn/client or window creation errors are returned.

## Security and invariants

- Renderer cannot access raw process handles or arbitrary executable launch through session mutation APIs.

## Verification

- PTY/io/output/activity tests
- terminal_window tests

## Source map

- `src-tauri/src/pty.rs`
- `src-tauri/src/session_output.rs`
- `src-tauri/src/session_activity.rs`
- `src-tauri/src/terminal_window.rs`
