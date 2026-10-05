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

`WorkspacePanel` composes focused child components, `useWorkspaceMutations` owns workspace writes, `useWorkspaceFileActions` owns tree file/folder edits and their dialogs, `useWorkspaceScan` owns scan/page state, and pure utilities derive hierarchy/filter/pin views.

## When

When the Workspaces activity mounts or any workspace/tree/filter/pin/move/import action occurs.

## Behavior

- Folder root label uses saved folder name.
- Mutation completion updates app-level workspace list.
- Pinning is visual structural priority, not duplicate shortcut.
- Drag and keyboard ordering share deterministic hierarchy semantics.
- The workspace header keeps search on its own row, with create as the primary action and add/import in the options menu.
- Expanded workspace rows use one icon, a restrained active surface, and an adjacent tree toolbar with a single labelled filter trigger.
- Each row's overflow menu groups contextual commands; terminal/run/connect remain quick actions when there is enough space. Destructive commands appear last.
- Narrow sidebars reduce indentation and move quick actions into the same contextual menus; hover does not change row widths.
- Overflow menus render in a portal, stay inside the viewport, support arrow keys/Home/End/Escape, and return focus to the trigger on Escape.
- Right-clicking any workspace, folder, file or connection row opens that row's overflow menu at the pointer; the context-menu key opens it under the row's trigger. Root folder filter/appearance and workspace appearance are menu items rather than separate right-click targets.
- Folder menus offer New file… and New folder…; file menus offer Rename file (inline, also F2), Move file to… and Delete file (confirmed, permanent, last).
- Workspace menus offer Move workspace up/down among siblings; Alt+ArrowUp/Alt+ArrowDown on the workspace row do the same and keep focus on the moved row.
- The file behind the active editor tab carries a persistent marker (`aria-current`) separate from the temporary reveal flash.

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
- `WorkspaceRowActions` — owned by this spec.
- `useRowContextMenu` — owned by this spec.
- `WorkspaceFolderRow` — owned by this spec.
- `WorkspaceFileRow` — owned by this spec.
- `WorkspaceFileDialogs` — owned by this spec.
- `CreateFolderDialog` — owned by this spec.
- `MoveFileDialog` — owned by this spec.
- `WorkspaceDialogFrame` — owned by this spec.
- `useWorkspaceFileActions` — owned by this spec.
- `moveDestinations` — owned by this spec.
- `useWorkspaceMutations` — owned by this spec.
- `useWorkspaceScan` — owned by this spec.
- `buildWorkspacePanelView` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `WorkspacePanel` | Compose workspace feature surface. | Primary workspace UX. | Combine mutations, scans, view model and children. | Workspace activity visible. |
| `WorkspacePanelHeader` | Render create/import/filter/search actions. | Keep header logic focused. | Invoke supplied actions and menu/search state. | Workspace header. |
| `WorkspaceContainerList` | Render nested ordered workspaces. | Visualize hierarchy/reorder. | Build rows, handle drag/drop, wire sibling move up/down and restore focus after a keyboard move. | Workspace list. |
| `WorkspaceRootRow` | Render one real folder root/tree. | Make multi-root names explicit. | Bind saved display name, double-click inline rename, tree actions and subtree. | Workspace has folder. |
| `WorkspaceEmptyState` | Render empty-container guidance/actions. | Empty workspace remains useful. | Offer Add Folder/new actions. | No folders. |
| `WorkspaceFilterMenu` | Render filter selectors and selected-type/file search. | Scale filter choices. | Search candidate display; checkbox changes explicit selection. | Filter open. |
| `WorkspaceSearchBar` | Render tree text search. | Quick tree narrowing. | Update query. | Workspace tree. |
| `WorkspaceTreeToolbar` | Render tree controls. | Central tree actions. | Bind expand/filter/menu callbacks. | Tree active. |
| `WorkspaceShowMore` | Load next page. | Large folder scalability. | Call paged scan callback. | Page has more. |
| `WorkspaceAddConnectionButton` | Start project connection flow. | Contextual connection creation. | Open form with workspace/folder. | Workspace connections. |
| `WorkspaceRowActions` | Present labelled contextual commands. | Keep tree rows readable and keyboard reachable. | Portal menu, focus handling and supplied callbacks; an `openAt` handle places it at a pointer. | Workspace, folder, file and connection actions. |
| `useRowContextMenu` | Route a row's right-click to its menu. | One menu per row, whichever way it is opened. | Prevent the native menu and call `openAt` with the pointer, or without one for the context-menu key. | Row right-click. |
| `WorkspaceFolderRow` | Render one folder row. | Keep tree rendering small. | Chevron, alias rename for roots, terminal quick action, grouped menu. | Folder node visible. |
| `WorkspaceFileRow` | Render one file row. | Keep tree rendering small. | Open/run, inline rename, edit menu, active-editor marker. | File node visible. |
| `WorkspaceFileDialogs` | Render the open tree edit dialog. | Keep dialogs out of the panel. | Switch on `useWorkspaceFileActions` state. | A tree edit is in progress. |
| `CreateFolderDialog` | Prompt a new folder name. | New folder from the tree. | Validate, call the supplied create, keep errors inline. | New folder… |
| `MoveFileDialog` | Pick a destination folder. | Move without drag-and-drop. | Filterable radio list (bounded), current folder disabled, errors inline. | Move file to… |
| `WorkspaceDialogFrame` | Shared modal shell. | Consistent tree dialogs. | Backdrop/Escape cancel, title, footer and error helpers. | Tree dialogs. |
| `useWorkspaceFileActions` | Own tree file/folder edits. | Keep the panel within size limits and edits testable. | Dialog state, `workspaceAPI` create/move/delete calls, expansion and reload of pins/scan. | Tree edit actions. |
| `moveDestinations` | List move targets. | Show folders as the tree names them. | Map scanned folder ids to root display names and sort. | Move dialog. |
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
- Open tree edit dialog and its target
- Active editor file (`workspaceId` + logical path)

## Errors and edge cases

- Native mutation/scan failure keeps prior authoritative state and surfaces error.
- New folder and move failures stay in their dialog; rename and delete failures are reported through the panel's alert.
- An editor tab open on a renamed, moved or deleted file is not retargeted; saving it reports the file as missing.

## Security and invariants

- Renderer passes logical IDs only; no direct filesystem access.
- Name, containment and kind rules for tree edits are enforced natively; renderer checks are only early feedback.

## Verification

- Workspace panel/header/root/list/filter tests
- workspaceHierarchy/workspaceFilter/scriptTree tests
- Tauri bridge contract tests
- WorkspaceFileRow/WorkspaceFolderRow/WorkspaceRowActions tests and the panel file-edit tests

## Source map

- `ui/components/WorkspacePanel.tsx`
- `ui/components/WorkspaceContainerList.tsx`
- `ui/components/WorkspaceRootRow.tsx`
- `ui/components/WorkspaceFilterMenu.tsx`
- `ui/components/WorkspaceRowActions.tsx`
- `ui/components/useRowContextMenu.ts`
- `ui/components/WorkspaceFolderRow.tsx`
- `ui/components/WorkspaceFileRow.tsx`
- `ui/components/WorkspaceFileDialogs.tsx`
- `ui/components/CreateFolderDialog.tsx`
- `ui/components/MoveFileDialog.tsx`
- `ui/components/WorkspaceDialogFrame.tsx`
- `ui/hooks/useWorkspaceFileActions.ts`
- `ui/utils/workspaceFileEdits.ts`
- `ui/components/workspace-file-tree.css`
- `ui/hooks/useWorkspaceMutations.ts`
- `ui/hooks/useWorkspaceScan.ts`
- `ui/workspaceAPI.ts`
