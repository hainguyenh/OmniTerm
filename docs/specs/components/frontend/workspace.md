---
id: component-frontend-workspace
status: current
area: components-frontend
navigation: "Renderer > Workspaces"
platforms:
  - renderer
  - desktop
tags:
  - react
  - workspace
  - hooks
related:
  - feature-workspace-tree-filter-pins
  - feature-workspace-hierarchy-order
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Component Frontend Workspace

## Description

Detailed catalog of React components/hooks that implement composite workspace creation/import, hierarchy, multi-root trees, filters, pins and project actions.

## What

The renderer owns interaction/derived view state; native workspace state is authoritative and all filesystem mutations/reads go through `workspaceAPI`.

## Why

Splitting the workspace surface prevents a large monolith and lets hierarchy/filter/scan/mutation logic be tested independently.

## How

`WorkspacePanel` composes focused child components, `useWorkspaceMutations` owns writes, `useWorkspaceScan` owns scan/page state, and pure utilities derive hierarchy/filter/pin views.

## When

When the Workspaces activity mounts or any workspace/tree/filter/pin/move/import action occurs.

## Behavior

- Folder root label uses saved folder name.
- Mutation completion updates app-level workspace list.
- Pinning is visual structural priority, not duplicate shortcut.
- Drag and keyboard ordering share deterministic hierarchy semantics.

## Functionalities

- `WorkspacePanel` — owned by this spec.
- `WorkspacePanelHeader` — owned by this spec.
- `WorkspaceContainerList` — owned by this spec.
- `WorkspaceRootRow` — owned by this spec.
- `WorkspaceEmptyState` — owned by this spec.
- `WorkspaceFilterMenu` — owned by this spec.
- `WorkspaceSearchBar` — owned by this spec.
- `WorkspaceTreeToolbar` — owned by this spec.
- `WorkspaceShowMore` — owned by this spec.
- `WorkspaceAddConnectionButton` — owned by this spec.
- `useWorkspaceMutations` — owned by this spec.
- `useWorkspaceScan` — owned by this spec.
- `buildWorkspacePanelView` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `WorkspacePanel` | Compose workspace feature surface. | Primary workspace UX. | Combine mutations, scans, view model and children. | Workspace activity visible. |
| `WorkspacePanelHeader` | Render create/import/filter/search actions. | Keep header logic focused. | Invoke supplied actions and menu/search state. | Workspace header. |
| `WorkspaceContainerList` | Render nested ordered workspaces. | Visualize hierarchy/reorder. | Build rows and handle drag/drop. | Workspace list. |
| `WorkspaceRootRow` | Render one real folder root/tree. | Make multi-root names explicit. | Bind saved display name, double-click inline rename, tree actions and subtree. | Workspace has folder. |
| `WorkspaceEmptyState` | Render empty-container guidance/actions. | Empty workspace remains useful. | Offer Add Folder/new actions. | No folders. |
| `WorkspaceFilterMenu` | Render filter selectors and selected-type/file search. | Scale filter choices. | Search candidate display; checkbox changes explicit selection. | Filter open. |
| `WorkspaceSearchBar` | Render tree text search. | Quick tree narrowing. | Update query. | Workspace tree. |
| `WorkspaceTreeToolbar` | Render tree controls. | Central tree actions. | Bind expand/filter/menu callbacks. | Tree active. |
| `WorkspaceShowMore` | Load next page. | Large folder scalability. | Call paged scan callback. | Page has more. |
| `WorkspaceAddConnectionButton` | Start project connection flow. | Contextual connection creation. | Open form with workspace/folder. | Workspace connections. |
| `useWorkspaceMutations` | Own create/import/add/move/rename/pin callbacks. | Centralize authoritative list synchronization. | Invoke API then refresh/replace state. | Workspace mutation. |
| `useWorkspaceScan` | Own skeleton/page scan state. | Separate async scanning from JSX. | Invoke scan endpoints and merge results. | Selection/expansion. |
| `buildWorkspacePanelView` | Derive render-ready filtered/pinned tree. | Pure deterministic view model. | Combine entries/filter/query/pins. | Panel state update. |

## State and data

- Workspace list/selection
- Expanded dirs
- Scan pages
- Filter/query
- Pins
- Drag state
- Loading/error state

## Errors and edge cases

- Native mutation/scan failure keeps prior authoritative state and surfaces error.

## Security and invariants

- Renderer passes logical IDs only; no direct filesystem access.

## Verification

- Workspace panel/header/root/list/filter tests
- workspaceHierarchy/workspaceFilter/scriptTree tests
- Tauri bridge contract tests

## Source map

- `ui/components/WorkspacePanel.tsx`
- `ui/components/WorkspaceContainerList.tsx`
- `ui/components/WorkspaceRootRow.tsx`
- `ui/components/WorkspaceFilterMenu.tsx`
- `ui/hooks/useWorkspaceMutations.ts`
- `ui/hooks/useWorkspaceScan.ts`
- `ui/workspaceAPI.ts`
