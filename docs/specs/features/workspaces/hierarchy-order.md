---
id: feature-workspace-hierarchy-order
status: current
area: workspaces
navigation: "Workspaces > drag/drop / move controls"
platforms:
  - desktop
  - tauri
tags:
  - workspace
  - hierarchy
  - ordering
related:
  - feature-workspace-model-persistence
  - component-frontend-workspace
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Workspace Hierarchy Order

## Description

Defines nesting as a stable workspace reference and ordering as a per-parent sibling sequence.

## What

A workspace has zero/one parent. Root and child sibling lists each have their own order. Drag/drop can reorder or nest; keyboard controls can change sibling position.

## Why

Hierarchy organizes projects without copying child data, and keyboard controls avoid drag-only accessibility.

## How

Renderer derives a forest and destination parent/index. Core `move_workspace` validates target/cycle, updates parent, and normalizes both old/new sibling lists. Removing a parent promotes children to that parent’s parent.

## When

On drag/drop, keyboard move, unnest/reparent and deletion.

## Behavior

- Nesting does not copy folders/pins/settings.
- Self-parent and descendant-parent are rejected.
- Same-parent before/after movement is deterministic.
- Child remains addressable by its original ID.

## Functionalities

- `buildWorkspaceForest` — owned by this spec.
- `siblingPosition` — owned by this spec.
- `workspaceDropIndex` — owned by this spec.
- `move_workspace` (core)` — owned by this spec.
- `move_workspace` (Tauri)` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `buildWorkspaceForest` | Project flat records to ordered tree. | Render hierarchy without duplicating persisted shape. | Group by parent and sort by order. | Workspace list render. |
| `siblingPosition` | Locate same-parent index/count. | Keyboard move controls. | Filter/sort siblings. | Move up/down. |
| `workspaceDropIndex` | Compute destination insertion index. | Avoid same-parent off-by-one. | Account for source removal before insert. | Drag/drop. |
| `move_workspace` (core) | Validate/reparent/reorder. | Authoritative hierarchy rules. | Reject self/descendant cycles then normalize sibling order. | Native move command. |
| `move_workspace` (Tauri) | Persist hierarchy mutation. | Synchronize durable state. | Load, delegate, write, return authoritative list. | UI move action. |

## State and data

- Flat Workspace records
- Derived forest
- parentId
- order
- drag source/target

## Errors and edge cases

- Unknown workspace/parent or cycle-producing move returns error and does not persist invalid state.

## Security and invariants

- Hierarchy grants no filesystem authority across workspace boundaries.

## Verification

- workspace_model move/cycle tests
- workspaceHierarchy utility tests
- WorkspaceContainerList UI tests

## Source map

- `crates/app-core/src/workspace_model.rs`
- `ui/utils/workspaceHierarchy.ts`
- `ui/components/WorkspaceContainerList.tsx`
- `ui/hooks/useWorkspaceMutations.ts`
