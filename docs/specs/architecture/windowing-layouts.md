---
id: architecture-windowing-layouts
status: current
area: architecture
navigation: "App > panes / detached terminal"
platforms:
  - desktop
  - tauri
tags:
  - window
  - layout
  - terminal
related:
  - feature-session-pty-detach
  - component-frontend-shell-layout
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Architecture Windowing Layouts

## Description

Defines pane layouts, split ratios, view groups, native window controls and detached terminal presentation.

## What

Layout state controls where content is shown; PTY/session process identity remains native and independent from the window/pane rendering it.

## Why

Users can rearrange/detach terminals without restarting processes or duplicating PTYs.

## How

Renderer hooks manage split/view state. `terminal_window` maps session IDs to detached windows and reattachment. `window_control` delegates minimize/maximize/close/zoom to Tauri.

## When

On layout changes, resize, fullscreen/maximize, detach/reattach/focus and window chrome actions.

## Behavior

- Layout changes preserve session IDs.
- Detach never starts a second PTY.
- Split ratios remain bounded.

## Functionalities

- `useSplitRatios` — owned by this spec.
- `useViewGroups` — owned by this spec.
- `detach_terminal` — owned by this spec.
- `reattach_terminal` — owned by this spec.
- `focus_terminal_window` — owned by this spec.
- `toggle_maximize` / `close_window` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `useSplitRatios` | Manage split ratios. | Stable bounded resize. | Track/update ratios. | Pane resize/restore. |
| `useViewGroups` | Manage grouped view tabs. | Organize multiple views. | Create/select/close group state. | View-group action. |
| `detach_terminal` | Move session presentation to detached window. | Separate UI placement from process lifetime. | Create/focus window tied to existing session ID. | Detach. |
| `reattach_terminal` | Return existing session to main renderer. | Reversible detach. | Release detached ownership and signal/attach main renderer. | Reattach. |
| `focus_terminal_window` | Focus existing detached terminal. | Avoid duplicate windows. | Resolve session window and focus. | Open already-detached session. |
| `toggle_maximize` / `close_window` | Native window control. | Desktop semantics. | Call Tauri window API. | Title bar/window command. |

## State and data

- Pane layout
- View groups
- Split ratios
- Session↔window attachment
- Window state

## Errors and edge cases

- Unknown/stale session/window IDs return error.

## Security and invariants

- Detached bootstrap accepts native-known session identity, not arbitrary launch payload.

## Verification

- Terminal-window tests
- Window-control tests
- Layout React tests

## Source map

- `ui/hooks/useSplitRatios.ts`
- `ui/hooks/useViewGroups.ts`
- `src-tauri/src/terminal_window.rs`
- `src-tauri/src/window_control.rs`
