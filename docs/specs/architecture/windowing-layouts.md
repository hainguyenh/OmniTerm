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

Defines pane layouts (1 to 8 panes, including oriented 5 and 7 pane modes), split ratios, view groups, native window controls, platform window corner rounding, and detached terminal presentation.

## What

Layout state controls where content is shown; PTY/session process identity remains native and independent from the window/pane rendering it. Window styling adapts to the desktop host with native transparent framing and window rounding.

## Why

Users can rearrange/detach terminals and switch between 1, 2, 3, 4, 5, 6, 7, or 8 pane layouts with orientation rotations without restarting processes or duplicating PTYs.

## How

Renderer hooks manage split/view state and orientation modes (`split2Style` for 2-pane columns/rows, `split3Style` for 3/5/7-pane top/left rotations). `useWindowRounding` manages desktop border-radius adaptations. `terminal_window` maps session IDs to detached windows and reattachment. `window_control` delegates minimize/maximize/close/zoom to Tauri.

## When

On layout changes, resize, fullscreen/maximize, orientation cycle, detach/reattach/focus, and window chrome actions.

## Behavior

- Layout changes preserve session IDs.
- Detach never starts a second PTY.
- Split ratios remain bounded.
- 1 to 8 pane layouts are selectable via shortcuts (`Ctrl+1` to `Ctrl+8`) or UI buttons. Modes 2, 3, 5, 7 support orientation rotation on repeat clicks.
- Window rounding applies an 8px border radius on supported platforms when not maximized.

## Functionalities

- `useSplitRatios` — owned by this spec.
- `useViewGroups` — owned by this spec.
- `useWindowRounding` — owned by this spec.
- `detach_terminal` — owned by this spec.
- `reattach_terminal` — owned by this spec.
- `focus_terminal_window` — owned by this spec.
- `toggle_maximize` / `close_window` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `useSplitRatios` | Manage split ratios and grid boundaries for 1 to 8 panes. | Stable bounded resize and orientation calculations. | Track/update ratios and compute pane rectangles. | Pane resize/restore or layout change. |
| `useViewGroups` | Manage grouped view tabs. | Organize multiple views. | Create/select/close group state. | View-group action. |
| `useWindowRounding` | Detect platform window rounding capability and maximize state. | Proper desktop corner curvature on Windows 11. | Inspects platform and window maximize state to toggle rounded shell styling. | Window mount, resize, and maximize. |
| `detach_terminal` | Move session presentation to detached window. | Separate UI placement from process lifetime. | Create/focus window tied to existing session ID. | Detach. |
| `reattach_terminal` | Return existing session to main renderer. | Reversible detach. | Release detached ownership and signal/attach main renderer. | Reattach. |
| `focus_terminal_window` | Focus existing detached terminal. | Avoid duplicate windows. | Resolve session window and focus. | Open already-detached session. |
| `toggle_maximize` / `close_window` | Native window control. | Desktop semantics. | Call Tauri window API. | Title bar/window command. |

## State and data

- Pane layout (modes 1–8)
- View groups
- Split ratios and orientation styles (`split2Style`, `split3Style`)
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
- Window rounding hook tests

## Source map

- `ui/hooks/useSplitRatios.ts`
- `ui/hooks/useViewGroups.ts`
- `ui/hooks/useWindowRounding.ts`
- `ui/paneLayout.ts`
- `src-tauri/src/terminal_window.rs`
- `src-tauri/src/window_control.rs`
