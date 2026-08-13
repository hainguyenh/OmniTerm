---
id: component-frontend-shell-layout
status: current
area: components-frontend
navigation: "Renderer shell"
platforms:
  - renderer
  - desktop
tags:
  - react
  - layout
  - components
related:
  - architecture-application-shell
  - architecture-windowing-layouts
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Component Frontend Shell Layout

## Description

Catalog of renderer shell, navigation, pane and overlay components.

## What

These components render the application frame and dispatch typed callbacks; they do not own native persistence/process handles.

## Why

Focused presentational units keep the main shell understandable and below repository complexity/LOC gates.

## How

Stateful `useMainLayout*` hooks/controllers produce props; shell components compose structure; native actions are injected through bridge callbacks.

## When

Whenever the main renderer mounts or navigation/layout/overlay/window state changes.

## Behavior

- Presentational shell components do not directly read/write native files.
- Pane/layout changes preserve unrelated sessions/workspaces.

## Functionalities

- `ActivityBar` — owned by this spec.
- `TitleBar` — owned by this spec.
- `CommandPalette` — owned by this spec.
- `MainLayoutView` — owned by this spec.
- `MainLayoutOverlays` — owned by this spec.
- `PaneHeader` — owned by this spec.
- `PaneResizers` — owned by this spec.
- `ViewGroupTabs` — owned by this spec.
- `FullscreenRestoreControl` — owned by this spec.
- `OverlayBar` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `ActivityBar` | Render primary activity navigation. | Stable route switching. | Buttons update selected activity. | Main shell visible. |
| `TitleBar` | Render custom title/window controls. | Desktop chrome. | Invoke native window-control callbacks. | Primary window. |
| `CommandPalette` | Search/execute app commands. | Keyboard-first control. | Filter registered commands and call action. | Palette invoked. |
| `MainLayoutView` | Render persistent layout. | Separate presentation from controller logic. | Compose sidebar/panes/content from props. | Normal render. |
| `MainLayoutOverlays` | Render transient dialogs/menus. | Isolate modal lifecycle. | Conditionally mount overlays. | Overlay active. |
| `PaneHeader` | Render pane chrome/actions. | Consistent pane UX. | Bind pane/session callbacks. | Pane visible. |
| `PaneResizers` | Render resize handles. | Layout sizing control. | Pointer changes bounded ratios. | Split layout. |
| `ViewGroupTabs` | Render grouped-view tabs. | Navigate grouped content. | Map view-group model to tabs. | View group exists. |
| `FullscreenRestoreControl` | Restore from fullscreen. | Keep escape route visible. | Invoke restore callback. | Fullscreen state. |
| `OverlayBar` | Render contextual overlay controls. | Consistent transient toolbar. | Present owning actions/status. | Overlay mode. |

## State and data

- Selected activity
- Pane layout
- Split ratios
- View groups
- Overlay state
- Window state

## Errors and edge cases

- Action failures are owned by controller/dialog state; stale IDs fall back safely.

## Security and invariants

- Native authority stays behind `omnitermAPI`.

## Verification

- MainLayout/overlays/pane component tests
- shortcut/window bridge tests

## Source map

- `ui/components/ActivityBar.tsx`
- `ui/components/TitleBar.tsx`
- `ui/components/CommandPalette.tsx`
- `ui/components/MainLayoutView.tsx`
- `ui/components/MainLayoutOverlays.tsx`
- `ui/components/PaneResizers.tsx`
