---
id: component-frontend-hooks-utilities
status: current
area: components-frontend
navigation: "Renderer hooks / utilities"
platforms:
  - renderer
  - desktop
tags:
  - react
  - hooks
  - typescript
  - utilities
related:
  - component-frontend-workspace
  - feature-terminal-lifecycle
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Component Frontend Hooks Utilities

## Description

Catalog of stateful hooks and pure utilities that isolate lifecycle/event logic and deterministic transformations from React component rendering.

## What

Hooks own subscriptions/asynchronous state; utilities own tree, shortcut, terminal, theme, clipboard/link and ordering calculations.

## Why

Focused hooks/utilities reduce component complexity, duplication and side-effect bugs while enabling fast unit tests.

## How

Hooks compose React state/effects/callbacks around `omnitermAPI` and clean resources. Utilities accept explicit inputs and return derived data or small bounded-resource controllers.

## When

Whenever owning components need lifecycle state, native events, or deterministic calculations.

## Behavior

- Hooks clean listeners/subscriptions.
- Pure utilities do not invoke Tauri.
- Logical workspace helpers do not claim native path safety.

## Functionalities

- `useAppShortcuts` — owned by this spec.
- `useDialog` / `useEscToClose` — owned by this spec.
- `useScriptRuns` — owned by this spec.
- `useShellOptions` — owned by this spec.
- `useSplitRatios` / `useViewGroups` — owned by this spec.
- `useTreeReveal` — owned by this spec.
- `useWorkspaceMutations` / `useWorkspaceScan` — owned by this spec.
- `useWindowRounding` — owned by this spec.
- `useSessionPersistence` / `useSessionRestore` — owned by this spec.
- `buildWorkspaceTree` / `filterTreeByQuery` — owned by this spec.
- `buildWorkspaceForest` / `workspaceDropIndex` — owned by this spec.
- `createSessionChannel` / `attachTerminalStream` — owned by this spec.
- `safeHttpUrl` / `isTerminalLinkModifierClick` — owned by this spec.
- `findLinkOrPathAt` / `createTerminalContextMenu` — owned by this spec.
- `parseAgentTitle` / `AGENT_REGISTRY` — owned by this spec.
- `persistencePolicy` — owned by this spec.
- `sessionStore` / `scrollbackStore` — owned by this spec.
- `shortcutFormatting` — owned by this spec.
- `themeCssVars` / `applyThemeVars` — owned by this spec.
- `createWebglController` / pool helpers — owned by this spec.
- `matchShortcut` / `resolveShortcuts` — owned by this spec.
- `normalizePastePayload` / `chunkForWrite` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `useAppShortcuts` | Bind resolved keyboard shortcuts. | Central shortcut lifecycle/focus rules. | Resolve config, register/cleanup listeners. | App shell mounted. |
| `useDialog` / `useEscToClose` | Manage dialog state/Escape close. | Reusable modal lifecycle. | State + key listener cleanup. | Dialog/overlay. |
| `useScriptRuns` | Coordinate script/file run/open actions. | Keep script interaction out of view JSX. | Map item actions to session/editor callbacks. | Workspace item action. |
| `useShellOptions` | Load native shell choices. | Renderer cannot infer installed shells. | Call shell-list API. | Shell selector. |
| `useSplitRatios` / `useViewGroups` | Manage layout/group state. | Central layout lifecycle. | State/update helpers. | Pane/group actions. |
| `useTreeReveal` | Reveal tree ancestors. | Make target visible. | Compute ancestor keys and expand. | Programmatic reveal. |
| `useWorkspaceMutations` / `useWorkspaceScan` | Workspace async lifecycle. | Separate writes/scans from rendering. | Call feature API and synchronize state. | Workspace actions. |
| `useWindowRounding` | Detect OS window corner rounding capability. | Apply correct platform titlebar styling. | Check OS platform and Tauri window state. | Window mount or resize. |
| `useSessionPersistence` / `useSessionRestore` | Snapshot and restore live sessions. | Preserve terminal state across runs. | Synchronize persistence policies and restore active PTYs. | Session mount/unmount and app launch. |
| `buildWorkspaceTree` / `filterTreeByQuery` | Build/search tree. | Pure deterministic workspace projection. | Map logical entries and preserve ancestors. | Tree render/search. |
| `buildWorkspaceForest` / `workspaceDropIndex` | Hierarchy/order calculations. | Correct nested reordering. | Group/sort/calculate indexes. | Workspace list/drop. |
| `createSessionChannel` / `attachTerminalStream` | Terminal event transport. | Reusable stream lifecycle. | Subscribe/cleanup/write chunks. | Terminal attach. |
| `safeHttpUrl` / `isTerminalLinkModifierClick` | Gate terminal links. | Prevent unsafe output-controlled navigation. | Parse/allow HTTP(S) and verify platform modifier. | Modifier-click gate. |
| `findLinkOrPathAt` / `createTerminalContextMenu` | Link/path detection and context menu handling. | Disambiguate link clicks from selection/paste. | Detect URLs/paths in terminal buffer and route contextmenu/mousedown. | Terminal interaction. |
| `parseAgentTitle` / `AGENT_REGISTRY` | Detect AI coding agents from OSC titles and provide resume recipes. | Recognize agents (Claude, Gemini, Aider, etc.) and automate session resumption. | Match title patterns against known agent signatures and load recipe configuration. | When session tabs, headers, or footers render agent info. |
| `persistencePolicy` | Derive and override per-session persistence policy (close-with-app, keep-running, freeze-while-closed, recover-after-reboot). | Consistent lifetime policy rules across renderer, snapshots, and daemon. | Validate policy types, default every terminal to close-with-app, and store explicit user overrides. | When persistence indicators render or policy is mutated. |
| `sessionStore` / `scrollbackStore` | Snapshot session layouts and cache terminal scrollback. | Preserve tabs, view groups, focused panes, and terminal output across app restarts. | Serializes versioned layout to localStorage and chunks raw PTY output into IndexedDB. | On layout changes, app shutdown, and startup restore. |
| `shortcutFormatting` | Parse shortcut combos and extract labels for keycap/tooltip display. | Clean visual presentation of keyboard bindings. | Splits modifiers and key names into tokens and extracts clean label text. | When rendering Keycap badges and shortcut tooltips. |
| `themeCssVars` / `applyThemeVars` | Project theme to CSS. | Consistent visual state. | Resolve fields and set CSS variables. | Theme change. |
| `createWebglController` / pool helpers | Manage bounded WebGL contexts. | Avoid context exhaustion. | Acquire/touch/release pooled resources. | Terminal rendering. |
| `matchShortcut` / `resolveShortcuts` | Keyboard matching/resolution. | Consistent shortcut semantics. | Normalize event/config and compare. | Keydown. |
| `normalizePastePayload` / `chunkForWrite` | Normalize/chunk terminal writes. | Stable terminal IO. | Transform/slice payload. | Paste/large output. |

## State and data

- Hook-local async state
- Event subscriptions
- Derived tree/layout/shortcut/theme data
- Bounded WebGL pool

## Errors and edge cases

- Invalid URLs/inputs return safe false/null/fallback per utility contract; async API errors remain with owning hook.

## Security and invariants

- Terminal link schemes are gated.
- Filesystem authorization remains native.

## Verification

- ui/hooks and ui/utils unit/integration tests

## Source map

- `ui/hooks`
- `ui/utils`
- `ui/components/useMainLayoutBase.tsx`
- `ui/components/useMainLayoutController.ts`
