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
- `buildWorkspaceTree` / `filterTreeByQuery` — owned by this spec.
- `buildWorkspaceForest` / `workspaceDropIndex` — owned by this spec.
- `createSessionChannel` / `attachTerminalStream` — owned by this spec.
- `safeHttpUrl` / `activateTerminalLink` — owned by this spec.
- `themeCssVars` / `applyThemeVars` — owned by this spec.
- `createWebglController` / pool helpers` — owned by this spec.
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
| `buildWorkspaceTree` / `filterTreeByQuery` | Build/search tree. | Pure deterministic workspace projection. | Map logical entries and preserve ancestors. | Tree render/search. |
| `buildWorkspaceForest` / `workspaceDropIndex` | Hierarchy/order calculations. | Correct nested reordering. | Group/sort/calculate indexes. | Workspace list/drop. |
| `createSessionChannel` / `attachTerminalStream` | Terminal event transport. | Reusable stream lifecycle. | Subscribe/cleanup/write chunks. | Terminal attach. |
| `safeHttpUrl` / `activateTerminalLink` | Gate terminal links. | Prevent unsafe output-controlled navigation. | Parse/allow HTTP(S). | Link click. |
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
