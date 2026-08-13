---
id: component-rust-workspace-core
status: current
area: components-rust
navigation: "crates/app-core workspace modules"
platforms:
  - desktop
  - tauri
tags:
  - rust
  - workspace
  - core
related:
  - feature-workspace-model-persistence
  - contract-workspace
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Component Rust Workspace Core

## Description

Function-level catalog for Tauri-free composite workspace model, import, hierarchy, pin and scan primitives.

## What

Workspace core owns deterministic schema transformation/validation and logical folder namespace rules used by native commands.

## Why

These rules must compile/test without Tauri and be shared consistently by persistence and all workspace operations.

## How

Functions accept protocol structs/paths, return explicit results/models, and use standard filesystem only where scanning/import canonicalization is part of the domain boundary.

## When

On workspace load/import/move/pin/path resolution and scan/page requests.

## Behavior

- No Tauri/AppHandle dependency.
- Validation occurs before state is accepted.
- Logical namespace is deterministic and folder IDs are separator-free.

## Functionalities

- `decode_workspaces` — owned by this spec.
- `validate_workspace_list` — owned by this spec.
- `parse_workspace_import` — owned by this spec.
- `move_workspace` — owned by this spec.
- `normalize_workspace_orders` — owned by this spec.
- `set_entry_pinned` — owned by this spec.
- `is_entry_pinned` — owned by this spec.
- `logical_target` — owned by this spec.
- `namespace_path` — owned by this spec.
- `scan_dir_excluding` — owned by this spec.
- `scan_entries_excluding` — owned by this spec.
- `scan_folders` — owned by this spec.
- `scan_folder_files_excluding` — owned by this spec.
- `scan_entries_page_excluding` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `decode_workspaces` | Decode current/legacy workspace JSON. | Automatic safe migration. | Shape-detect legacy before current serde; migrate and validate. | Persistence read. |
| `validate_workspace_list` | Validate workspace graph/folders/pins. | Reject corrupt state. | Check unique IDs, folder IDs, references and cycles. | Decode/write. |
| `parse_workspace_import` | Parse VS Code/VSCodium file. | Import names/local roots only. | Resolve relative dirs, canonicalize, dedupe, skip unusable. | Import. |
| `move_workspace` | Reparent/reorder workspace. | Hierarchy support. | Validate parent/cycle and normalize sibling lists. | Move action. |
| `normalize_workspace_orders` | Normalize all sibling order values. | Deterministic persistence/display. | Group by parent then rewrite dense order. | Migration/delete. |
| `set_entry_pinned` | Add/remove pin identity. | Durable structural priority. | Normalize relative path and update pins. | Pin action. |
| `is_entry_pinned` | Query pin identity. | Pinned-first sorting. | Compare normalized folder/path. | Tree derivation. |
| `logical_target` | Resolve logical path to folder + relative path. | Explicit real-root selection. | Split first path segment and lookup folder ID. | Before IO/run. |
| `namespace_path` | Build logical namespaced path. | Avoid cross-root collisions. | Join folder ID with relative path. | Scan result identity. |
| `scan_dir_excluding` | Scan runnable scripts with exclusions. | Script discovery. | Walk root/classify/filter. | Script refresh. |
| `scan_entries_excluding` | Scan entries with exclusions. | File/tree discovery. | Walk/classify/filter. | Entry scan. |
| `scan_folders` | Scan directory skeleton. | Fast lazy tree. | Enumerate directories. | Initial scan. |
| `scan_folder_files_excluding` | Page files in one relative folder. | Bound large directory payload. | Validate folder, scan/classify and slice offset/limit. | Expand/show more. |
| `scan_entries_page_excluding` | Generic paged entry scan. | Reusable bounded scanning. | Resolve relative dir and paginate. | Paged scan. |

## State and data

- Workspace protocol models
- Decoded migration flag
- LogicalTarget
- WorkspaceScript/Entry/Page
- Path inputs

## Errors and edge cases

- Invalid JSON/schema/reference/cycle/path returns explicit error; unavailable scan roots follow scan contract.

## Security and invariants

- No runtime unwrap/expect on untrusted production paths.
- Folder namespace never substitutes canonical containment.

## Verification

- workspace_model_tests
- workspace_scan_tests/contract/paging tests
- rust crate-import regression

## Source map

- `crates/app-core/src/workspace_model.rs`
- `crates/app-core/src/workspace_scan.rs`
- `crates/app-core/src/workspace_scan_paging.rs`
