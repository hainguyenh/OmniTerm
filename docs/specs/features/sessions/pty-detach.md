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

Defines native PTY ownership, output/activity processing, and moving an existing live session between main and detached windows during one OmniTerm run.

## What

The out-of-process session daemon owns PTY/process handles and the live session registry. Detachment changes presentation ownership only.

## Why

A terminal should move between OmniTerm windows without starting a duplicate process, while application exit must still terminate the process.

## How

PTY commands operate on stable live session IDs. The daemon buffers runtime output and derives activity, while the Tauri bridge forwards its stream over renderer channels. `terminal_window` maps an existing session ID to a detached window and reattaches it without restarting the PTY.

## When

On session start/input/resize/output/stop/disconnect and detach/reattach/focus, within the current app lifetime.

## Behavior

- One live native session per session ID.
- Detach/reattach preserves process/session identity while OmniTerm remains running.
- Runtime replay is emitted before the live daemon stream when a detached renderer attaches, preserving output ordering within the current application lifetime.
- Closing OmniTerm is not a detach operation: GUI lease loss terminates its owned PTYs, and the daemon exits when no owned sessions remain.
- App restart reconstructs saved panes with fresh PTYs at saved working directories; detached/live process state is not resumed across app runs.

## Functionalities

- `start_local_session` — owned by this spec.
- `send_session_input` — owned by this spec.
- `resize_session` — owned by this spec.
- `kill_session` / `disconnect_session` — owned by this spec.
- `attach_existing_session` — owned by this spec for same-app detached-window attach/reattach.
- daemon output/activity streaming — owned by `session-core`.
- `detach_terminal` — owned by this spec.
- `reattach_terminal` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `start_local_session` | Start a native PTY. | Own process lifecycle natively. | Resolve launch, kill stale same-ID state, create a close-with-app PTY, register IO loops. | Fresh session start. |
| `send_session_input` | Write session input. | Interactive shell. | Lookup writer by live session ID. | User input. |
| `resize_session` | Resize PTY. | Match UI geometry. | Lookup PTY and resize. | Pane/xterm resize. |
| `kill_session` / `disconnect_session` | Stop/release session. | Explicit lifecycle. | Lookup registry and terminate/release. | Close/disconnect. |
| `attach_existing_session` | Attach another OmniTerm window to an existing live PTY. | Move presentation without spawning. | Subscribe to current daemon replay/live stream. | Detach/reattach in the same app run. |
| daemon output/activity | Buffer runtime replay and publish state. | Keep window moves independent of renderer lifetime. | `session-core` owns runtime replay plus process/activity sampling. | Live session. |
| `detach_terminal` | Create/focus detached renderer for existing session. | Move presentation without a new PTY. | Bind session ID to a Tauri window. | Detach. |
| `reattach_terminal` | Return presentation to main app. | Reversible detach. | Release detached mapping and reattach. | Reattach. |

## State and data

- Live daemon session registry
- Daemon-owned PTY handles
- Bounded runtime replay
- Daemon-owned activity metrics
- Window attachment map

No detached-window state is a guarantee of process survival after OmniTerm exits.

## Errors and edge cases

- Unknown session/window, spawn/client, or window creation errors are explicit.
- App restart never treats a previous detached session as attachable process state.

## Security and invariants

- Renderer cannot access raw process handles or arbitrary executable launch through session mutation APIs.
- Detach is presentation migration, not process persistence.

## Verification

- session-core lifecycle/replay/activity tests
- Tauri bridge and terminal_window tests
- GUI lease-loss termination tests

## Source map

- `src-tauri/src/pty.rs`
- `crates/session-core/src/manager.rs`
- `crates/session-core/src/output.rs`
- `crates/session-core/src/activity.rs`
- `crates/session-core/src/agent_activity.rs`
- `src-tauri/src/terminal_window.rs`
