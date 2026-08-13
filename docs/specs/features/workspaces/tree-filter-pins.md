---
id: feature-workspace-tree-filter-pins
status: current
area: workspaces
navigation: "Workspace tree > filter/pin"
platforms:
  - desktop
  - tauri
tags:
  - workspace
  - tree
  - filter
  - pin
related:
  - feature-workspace-operations
  - component-frontend-workspace
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Workspace Tree Filter Pins

## Description

Defines multi-root tree presentation, lazy file pages, selected-type/file search fields and structural pinned ordering.

## What

Each real folder is a named synthetic top-level node; descendants use `<folderId>/<relativePath>`. Filters restrict tree content. Pinning prioritizes a file/folder at the top of its real sibling list without creating a duplicate shortcut.

## Why

Multi-root projects need unambiguous identities, scalable scanning and fast access to important entries.

## How

Backend returns folder skeleton and paged namespaced entries. Renderer builds the tree, preserves required ancestors, applies hidden/script/type/file/query filters, and sorts pin identities before unpinned siblings. Search inside selected-type/file selectors narrows displayed candidates only.

## When

When tree loads/expands, filters/search change, pin state changes or Show More loads a page.

## Behavior

- Synthetic root displays `WorkspaceFolder.name`, not internal folder ID.
- Pinning does not move a file on disk.
- Pinned entry stays under its real parent.
- Filter search does not silently deselect hidden candidates.
- Folder skeleton can render before file pages.

## Functionalities

- `scan_workspace_folders` — owned by this spec.
- `scan_workspace_entries` — owned by this spec.
- `WorkspaceFilterMenu` — owned by this spec.
- `applyFilter` — owned by this spec.
- `workspacePinTarget` — owned by this spec.
- `set_entry_pinned` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `scan_workspace_folders` | Return named root nodes and directory skeleton. | Fast, unambiguous initial tree. | Emit each folder root then namespaced dirs. | Workspace selected. |
| `scan_workspace_entries` | Page one logical folder directory. | Bound large trees. | Resolve folder namespace then scan page and namespace output. | Expand/show more. |
| `WorkspaceFilterMenu` | Render filter choices/search. | Manage many selected types/files. | Search narrows candidates; explicit checkbox action changes selection. | Filter menu open. |
| `applyFilter` | Apply tree filter rules. | One deterministic filter model. | Evaluate hidden/scripts/types/files and preserve needed dirs. | Filter changes. |
| `workspacePinTarget` | Map logical entry to pin identity. | Stable composite pin persistence. | Split folder ID from relative path. | Pin action. |
| `set_entry_pinned` | Persist pin/unpin. | Durable pinned-first order. | Normalize path, remove duplicate, append when pinning. | Native pin command. |

## State and data

- Scan skeleton/pages
- Expanded dirs
- Text query
- TreeFilter selected kinds/files
- Workspace pins

## Errors and edge cases

- Unavailable folders remain visible but scan/action can fail.
- Stale file pin is simply absent until matching entry exists; invalid folder pin is rejected in persisted state.

## Security and invariants

- Logical paths are identifiers, not native paths.
- Filters cannot broaden native view/edit/run permission.

## Verification

- WorkspaceFilterMenu tests
- workspaceFilter/scriptTree tests
- WorkspacePanel/tree tests
- pin model tests

## Source map

- `ui/components/WorkspaceFilterMenu.tsx`
- `ui/utils/workspaceFilter.ts`
- `ui/utils/scriptTree.ts`
- `ui/utils/workspaceHierarchy.ts`
- `src-tauri/src/workspace.rs`
