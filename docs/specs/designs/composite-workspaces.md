---
id: design-composite-workspaces
status: current
area: designs
navigation: "Design record"
platforms:
  - desktop
  - tauri
tags:
  - workspace
  - design
  - migration
related:
  - feature-workspace-model-persistence
  - feature-workspace-import
  - feature-workspace-hierarchy-order
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Design Composite Workspaces

## Description

Approved design record for replacing the old one-path Workspace with one native composite container model.

## What

A workspace can own many unrelated folders and can be nested under another workspace by reference. Filesystem actions always select one real folder root.

## Why

The alternatives—virtual merged filesystem or wrapper collections around legacy single-path workspaces—create path collisions, ambiguous cwd/safety rules or permanent dual models.

## How

Legacy records migrate to one-folder containers; editor workspace import populates multiple folders; `parentId`/`order` encode hierarchy; folder IDs namespace tree/IPC paths; pins are structural priority metadata.

## When

This decision governs workspace model/persistence/UI/native APIs after the composite-workspace migration.

## Behavior

- No virtual merged filesystem.
- No destructive file move for pin/reorder.
- Nested workspace remains independently addressable.
- Legacy ID/name are preserved.

## Functionalities

- `Composite container` — owned by this spec.
- `Reference hierarchy` — owned by this spec.
- `Sibling order` — owned by this spec.
- `Folder namespace` — owned by this spec.
- `Structural pin` — owned by this spec.
- `Automatic migration` — owned by this spec.
- `Editor import` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| Composite container | Store `folders[]` directly on Workspace. | One long-term model. | Protocol/persistence schema. | All workspace behavior. |
| Reference hierarchy | Use parent workspace ID. | No copy/merge/destructive nesting. | `parentId` with cycle validation. | Nest/move. |
| Sibling order | Persist per-parent `order`. | User-controlled list position. | Normalize after move/delete/migration. | Reorder. |
| Folder namespace | Use `<folderId>/<relativePath>`. | No collisions/fake merged root. | Namespace scan results and resolve before IO. | Tree/IPC actions. |
| Structural pin | Persist folder+relative identity and sort first. | Priority without duplicate shortcut/filesystem move. | `pins[]` + renderer sort. | Pin/unpin. |
| Automatic migration | Convert old `path` into one folder. | No manual user upgrade. | Shape-detect legacy before current deserialize. | First old-state load. |
| Editor import | Accept `.code-workspace` and `.workspace`. | Reuse VS Code/VSCodium grouping. | Import only usable local folder names/paths. | Import action. |

## State and data

- Current composite schema
- Legacy schema only during migration
- Hierarchy/order/pins/logical paths

## Errors and edge cases

- Cycles/invalid refs reject; no usable import roots rejects; multi-folder implicit quick-shell cwd is intentionally unavailable.

## Security and invariants

- Folder-scoped safepath is a core design invariant.

## Verification

- Workspace model/import/hierarchy/IPC/UI tests
- detailed spec structure test

## Source map

- `crates/app-protocol/src/workspace.rs`
- `crates/app-core/src/workspace_model.rs`
- `src-tauri/src/workspace.rs`
- `ui/utils/workspaceHierarchy.ts`
