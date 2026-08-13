---
id: feature-workspace-model-persistence
status: current
area: workspaces
navigation: "Activity Bar > Workspaces"
platforms:
  - desktop
  - tauri
tags:
  - workspace
  - model
  - migration
related:
  - contract-workspace
  - component-rust-workspace-core
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Workspace Model Persistence

## Description

Defines Workspace as a persistent logical container that can own multiple unrelated filesystem folders and be nested under another workspace by reference.

## What

`Workspace` stores stable ID/name, `folders[]`, optional `parentId`, sibling `order`, and folder-relative `pins[]`. The workspace itself is not a filesystem directory.

## Why

Real projects span multiple paths and users need hierarchy without copying/merging child workspace contents.

## How

Protocol structs serialize the current schema. `decode_workspaces` shape-detects old `{id,name,path}` records before current serde decoding, converts each to one folder while preserving workspace ID/name, validates, and persistence rewrites the migrated data.

## When

At startup and every workspace create/import/add-folder/move/pin/remove persistence operation.

## Behavior

- Legacy workspace ID/name are preserved.
- Legacy path becomes one named folder.
- Nested child remains independent; parent is only a reference.
- Deleting parent re-parents children instead of deleting them.
- List position is user order, not alphabetical refresh.

## Functionalities

- `decode_workspaces` — owned by this spec.
- `validate_workspace_list` — owned by this spec.
- `normalize_workspace_orders` — owned by this spec.
- `read_workspaces` — owned by this spec.
- `write_workspaces` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `decode_workspaces` | Decode current or legacy JSON. | Lossless schema upgrade. | Parse values, detect legacy shape, migrate then validate. | Read `workspaces.json`. |
| `validate_workspace_list` | Validate IDs/folders/parents/pins/cycles. | Reject corrupt state. | Build identity sets and walk parent chains. | After decode/before write. |
| `normalize_workspace_orders` | Normalize per-parent sibling order. | Stable deterministic list ordering. | Rewrite dense order for each parent group. | Migration/delete/move. |
| `read_workspaces` | Load and migrate persisted state. | Single persistence read boundary. | Read app-data JSON, decode, rewrite if migrated. | List/command load. |
| `write_workspaces` | Validate and persist current schema. | Prevent invalid durable state. | Validate, serialize and write app-data JSON. | Workspace mutation. |

## State and data

- Workspace.id/name
- WorkspaceFolder.id/name/path
- parentId
- order
- pins
- workspaces.json

## Errors and edge cases

- Duplicate/empty IDs, invalid folder IDs, missing parents, cycles and pins for unknown folders are rejected.

## Security and invariants

- Persisted paths are metadata; operations still resolve and validate native targets.

## Verification

- workspace_model migration/validation/order tests
- workspace persistence/command tests

## Source map

- `crates/app-protocol/src/workspace.rs`
- `crates/app-core/src/workspace_model.rs`
- `src-tauri/src/workspace_persistence.rs`
- `contract/index.ts`
