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

Defines pane layouts (1 to 8 panes, including oriented 5 and 7 pane modes), split ratios, view groups, native window controls, app fullscreen (F11), platform window corner rounding, and detached terminal presentation.

## What

Layout state controls where content is shown; PTY/session process identity remains native and independent from the window/pane rendering it. Window styling adapts to the desktop host with native transparent framing and window rounding. App fullscreen switches the main window to true OS-level fullscreen and hides every chrome surface except the terminal pane grid and the status footer.

## Why

Users can rearrange/detach terminals and switch between 1, 2, 3, 4, 5, 6, 7, or 8 pane layouts with orientation rotations without restarting processes or duplicating PTYs. App fullscreen gives terminals the whole screen without losing session state or status context.

## How

Renderer hooks manage split/view state and orientation modes (`split2Style` for 2-pane columns/rows, `split3Style` for 3/5/7-pane top/left rotations). `useWindowRounding` manages desktop border-radius adaptations. `terminal_window` maps session IDs to detached windows and reattachment. `window_control` delegates minimize/maximize/close/fullscreen/zoom to Tauri. App fullscreen is a single renderer state in App: `useAppShortcuts` matches the rebindable `toggleAppFullscreen` shortcut (default `F11`; bare function-key bindings survive terminal focus), the state drives conditional TitleBar rendering and the `chromeHidden` prop into `MainLayoutView`, and Escape exits.

## When

On layout changes, resize, fullscreen/maximize, orientation cycle, detach/reattach/focus, and window chrome actions. F11 press enters/exits app fullscreen; Escape exits while active.

## Behavior

- Layout changes preserve session IDs.
- Detach never starts a second PTY.
- Split ratios remain bounded (`MIN_FRACTION`); panes are percentage geometry with no pixel floor.
- Pane area and pane frames clip overflow (`overflow-hidden`) — an oversized xterm canvas never scrolls or paints outside the desktop.
- 1 to 8 pane layouts are selectable via shortcuts (`Ctrl+1` to `Ctrl+8`) or UI buttons. Modes 2, 3, 5, 7 support orientation rotation on repeat clicks.
- Window rounding applies an 8px border radius on supported platforms when not maximized.
- App fullscreen (`F11`, rebindable) toggles native OS fullscreen together with chrome hiding; the pane grid and status footer remain visible.
- On Windows, entering fullscreen first normalizes frame geometry through a maximize/unmaximize cycle — frameless transparent windows otherwise keep the client area at work-area height and leave the taskbar visible below.
- App fullscreen is not persisted — a fresh launch always starts windowed. Escape also exits it, per-pane fullscreen stays orthogonal, detached windows are unaffected, and corner rounding is suppressed while active.

## Functionalities

- `useSplitRatios` — owned by this spec.
- `useViewGroups` — owned by this spec.
- `useWindowRounding` — owned by this spec.
- `toggleAppFullscreen` shortcut — owned by this spec.
- `detach_terminal` — owned by this spec.
- `reattach_terminal` — owned by this spec.
- `focus_terminal_window` — owned by this spec.
- `toggle_maximize` / `close_window` — owned by this spec.
- `set_fullscreen` — owned by this spec.

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
| `set_fullscreen` | Toggle native OS fullscreen. | Cover the taskbar like desktop terminals do. | Call Tauri `set_fullscreen` with the requested state. | F11 toggle. |
| App chrome fullscreen state | Hide chrome except panes and status footer. | Immersive terminal focus. | Single React state in App drives conditional TitleBar render and the `chromeHidden` prop. | F11/Escape. |

## State and data

- Pane layout (modes 1–8)
- View groups
- Split ratios and orientation styles (`split2Style`, `split3Style`)
- Session↔window attachment
- Window state
- App fullscreen (`chromeHidden`)

## Errors and edge cases

- Unknown/stale session/window IDs return error.

## Security and invariants

- Detached bootstrap accepts native-known session identity, not arbitrary launch payload.

## Verification

- Terminal-window tests
- Window-control tests
- Layout React tests
- Window rounding hook tests
- App fullscreen React tests (shortcut survival, chrome hiding)

## Source map

- `ui/hooks/useSplitRatios.ts`
- `ui/hooks/useViewGroups.ts`
- `ui/hooks/useWindowRounding.ts`
- `ui/hooks/useAppShortcuts.ts`
- `ui/App.tsx`
- `ui/paneLayout.ts`
- `src-tauri/src/terminal_window.rs`
- `src-tauri/src/window_control.rs`
