---
id: architecture-application-shell
status: current
area: architecture
navigation: "App > Main window"
platforms:
  - renderer
  - desktop
tags:
  - shell
  - renderer
  - navigation
related:
  - component-frontend-shell-layout
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Architecture Application Shell

## Description

Defines how OmniTerm composes title bar, activity navigation, panes, overlays, workspace surfaces and session content in the primary renderer.

## What

The application shell is the renderer coordinator. It chooses visible product surfaces and wires controllers to presentational components without owning filesystem/process authority.

## Why

Separating composition from native side effects keeps layout/navigation testable and prevents UI state from becoming a second backend.

## How

`MainLayout` delegates state to `useMainLayoutBase`, `useMainLayoutController` and `useMainLayoutSessions`; `MainLayoutView` renders persistent structure and `MainLayoutOverlays` renders transient layers. Native work goes through `omnitermAPI`.

## When

Whenever the main OmniTerm window mounts, navigation changes, a pane/view-group changes, or an overlay opens/closes.

## Behavior

- Navigation does not restart sessions.
- Overlay state does not replace persistent pane state.
- Window controls are routed through Tauri.
- Generated Windows icons use the full logo at normal sizes and a simplified front-terminal composition at 16–48 px so small OS icon slots remain legible.

## Functionalities

- `MainLayout` — owned by this spec.
- `MainLayoutView` — owned by this spec.
- `MainLayoutOverlays` — owned by this spec.
- `CommandPalette` — owned by this spec.
- `TitleBar` — owned by this spec.
- `PaneResizers` — owned by this spec.
- `generateAppAssets` / `iconSourceLayout` — owned by this spec for application-logo derivatives.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `MainLayout` | Top-level renderer composition. | One shell owner. | Combines controller/hooks and view. | Primary window mount. |
| `MainLayoutView` | Render stable visual shell. | Keep JSX presentational. | Compose activity/sidebar/panes/content from props. | Normal render. |
| `MainLayoutOverlays` | Render transient dialogs/menus. | Isolate modal lifecycle/z-order. | Conditionally mount overlays from controller state. | Overlay active. |
| `CommandPalette` | Search and execute registered UI commands. | Fast keyboard navigation/actions. | Filter command model and call selected action. | Palette invoked. |
| `TitleBar` | Render desktop title/window controls. | Custom desktop chrome. | Bind native window-control actions. | Main window visible. |
| `PaneResizers` | Resize split panes. | User-controlled layout. | Pointer deltas update bounded split ratios. | Split layout active. |
| `generateAppAssets` | Generate renderer and desktop logo derivatives from the single original asset. | Avoid hand-maintained/stale binary derivatives. | Build WebP, PNG and multi-resolution ICO outputs before dev/build/test flows. | Asset generation runs before repository frontend/build gates. |
| `iconSourceLayout` | Choose full or compact source composition for each icon size. | The full glowing three-window mark loses edge clarity at tiny Windows icon sizes. | Use the front terminal crop through 48 px; keep the complete logo above 48 px. | Every generated PNG/ICO frame. |

## State and data

- Selected activity/view
- Pane/view-group layout
- Overlay/dialog state
- Workspace/session projections

## Errors and edge cases

- Stale selected IDs fall back to valid state.
- Native action failures surface through owning controller/toast/dialog.
- Small-icon layout rejects non-positive/non-integer dimensions; source-logo generation still requires a square alpha PNG of at least 512×512.

## Security and invariants

- Renderer shell never treats paths or command strings as native authority.

## Verification

- MainLayout/overlay/pane React tests
- Tauri bridge contract tests
- Shortcut tests
- `scripts/__tests__/app-assets.test.mjs` and `small-icon-layout.test.mjs`

## Source map

- `ui/components/MainLayout.tsx`
- `ui/components/MainLayoutView.tsx`
- `ui/components/MainLayoutOverlays.tsx`
- `ui/components/TitleBar.tsx`
- `ui/omnitermAPI.ts`
- `scripts/generate-app-assets.mjs`
- `scripts/image/app-icon-layout.mjs`
