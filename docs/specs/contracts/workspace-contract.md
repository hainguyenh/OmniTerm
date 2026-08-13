---
id: contract-workspace
status: current
area: contracts
navigation: "Rust protocol / TypeScript contract"
platforms:
  - desktop
  - tauri
tags:
  - workspace
  - contract
  - serialization
related:
  - feature-workspace-model-persistence
  - architecture-runtime-boundaries
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Contract Workspace

## Description

Defines the serialized composite workspace model and logical path contract shared by Rust persistence/IPC and TypeScript renderer.

## What

`Workspace` contains `id`, `name`, `folders`, optional `parentId`, `order`, and `pins`; `WorkspaceFolder` contains ID/name/native path; `WorkspacePin` contains folder ID and relative path. Logical entry identity is `<folderId>/<relativePath>`.

## Why

All layers must agree exactly on serialized fields and identity semantics or migration/IPC/tree behavior can corrupt or fail.

## How

Rust `app_protocol::workspace` uses serde camelCase and TypeScript `contract/index.ts` mirrors the shape. `app-core` validates/migrates data. Logical paths are resolved by `logical_target`, never treated as native paths.

## When

Whenever workspace data is persisted, returned by IPC, rendered, migrated, pinned or used for file/run actions.

## Behavior

- Rust serde field names are camelCase.
- Folder IDs are unique per workspace and cannot contain slash separators.
- parentId references another workspace or null.
- order is among same-parent siblings.

## Functionalities

- `Workspace` — owned by this spec.
- `WorkspaceFolder` — owned by this spec.
- `WorkspacePin` — owned by this spec.
- `WorkspaceImport` — owned by this spec.
- `logical_target` — owned by this spec.
- `namespace_path` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `Workspace` | Composite container model. | One cross-layer durable workspace shape. | Serde/TypeScript fields for identity/folders/hierarchy/order/pins. | Persistence/IPC/UI. |
| `WorkspaceFolder` | One real filesystem root. | Represent many unrelated roots. | Stable ID, display name and canonical path. | Folder-scoped operation. |
| `WorkspacePin` | Pinned entry identity. | Persist structural priority. | Folder ID + normalized relative path. | Pin/tree sort. |
| `WorkspaceImport` | Internal parsed import model. | Keep editor input schema separate from durable model. | Name + parsed folders before new OmniTerm IDs. | Import parse. |
| `logical_target` | Resolve logical path. | Map renderer identity to exact root. | Split first segment as folder ID. | IO/run. |
| `namespace_path` | Create logical path. | Avoid root collisions. | Join folder ID and relative path. | Scan output/tree identity. |

## State and data

- Serialized JSON
- Rust protocol structs
- TypeScript interfaces
- Logical path strings

## Errors and edge cases

- Invalid/missing references are rejected by model validation; unsupported legacy shape is handled only by explicit migration.

## Security and invariants

- Native folder path is metadata but renderer logical path cannot authorize arbitrary native path.

## Verification

- Protocol/IPC tests
- workspace model migration/validation tests
- Tauri bridge contract tests

## Source map

- `crates/app-protocol/src/workspace.rs`
- `contract/index.ts`
- `crates/app-core/src/workspace_model.rs`
