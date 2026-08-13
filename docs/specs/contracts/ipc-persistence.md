---
id: contract-ipc-persistence
status: current
area: contracts
navigation: "Tauri commands / app data"
platforms:
  - desktop
  - tauri
tags:
  - ipc
  - persistence
  - tauri
related:
  - architecture-runtime-boundaries
  - contract-workspace
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Contract Ipc Persistence

## Description

Defines Tauri command registration/payload conventions and durable state ownership.

## What

Renderer invokes named native capabilities with structured payloads; native code owns app-data/project-file persistence and returns success only after the operation/persistence boundary succeeds.

## Why

Explicit IPC prevents hidden renderer filesystem/process access and catches command/payload drift.

## How

`src-tauri/src/lib.rs` registers commands via `generate_handler!`; `omnitermAPI`/feature APIs wrap `invoke`; native persistence helpers validate/sanitize before write. Project-scoped files live under actual workspace folders.

## When

For every renderer-native action or durable load/save.

## Behavior

- Unregistered/mismatched command names fail instead of silently falling back.
- Mutation UI can replace/refresh from returned authoritative state.
- Composite workspace container is not used as a fake project directory.

## Functionalities

- `generate_handler!` — owned by this spec.
- `invoke` wrappers` — owned by this spec.
- `read_workspaces` / `write_workspaces` — owned by this spec.
- `load_connections` / `save_connections` — owned by this spec.
- `Workspace connection commands` — owned by this spec.
- `Settings/theme commands` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `generate_handler!` | Declare callable native commands. | Explicit capability surface. | Register command functions in Tauri builder. | App startup. |
| `invoke` wrappers | Call registered command with payload. | Central renderer/native naming. | Feature API methods wrap Tauri invoke. | UI native action. |
| `read_workspaces` / `write_workspaces` | Workspace durable boundary. | Validated migration/current schema. | App-data read/decode/rewrite or validate/serialize/write. | Workspace load/mutation. |
| `load_connections` / `save_connections` | Global connection persistence. | Durable reusable profiles. | Read/sanitize/write app-data JSON. | Connection load/mutation. |
| Workspace connection commands | Project-folder profile persistence. | Portable project scope. | Use real workspace folder `.omniterm/connections.json`. | Workspace profile action. |
| Settings/theme commands | App preference/custom theme persistence. | Central native file ownership. | Validated app-data/custom-theme IO. | Settings/theme action. |

## State and data

- Registered command set
- IPC payload/result JSON
- App-data files
- Project `.omniterm` files

## Errors and edge cases

- Invoke mismatch and persistence failure return errors; native success is not sent early.

## Security and invariants

- Native command validates untrusted input before filesystem/process effects.

## Verification

- IPC contract/runtime/edge tests
- ui Tauri bridge contract test
- persistence tests

## Source map

- `src-tauri/src/lib.rs`
- `ui/omnitermAPI.ts`
- `ui/workspaceAPI.ts`
- `src-tauri/src/workspace_persistence.rs`
- `src-tauri/src/connections.rs`
