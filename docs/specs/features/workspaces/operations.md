---
id: feature-workspace-operations
status: current
area: workspaces
navigation: "Workspace file/folder actions"
platforms:
  - desktop
  - tauri
tags:
  - workspace
  - filesystem
  - terminal
  - scripts
related:
  - architecture-security-data
  - component-rust-filesystem-launch
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Workspace Operations

## Description

Defines scan/read/write/run/terminal actions as explicitly folder-scoped operations inside a composite workspace.

## What

Every filesystem/process action resolves `<folderId>/<relativePath>` to one saved real root before native access. A composite container has no fake merged cwd.

## Why

Unrelated roots can live on different drives/paths; explicit folder scope prevents collisions, unsafe path assumptions and ambiguous terminals.

## How

Native commands find workspace, call `logical_target`, then safepath/scan helpers operate on the real root plus relative path. Returned entries/scripts are re-namespaced for renderer identity.

## When

On workspace scan, file open/save, script/RDP run or Open Terminal from a folder/subfolder.

## Behavior

- Multi-folder workspace is not an implicit quick-shell cwd.
- Folder/subfolder terminal action supplies an explicit logical target.
- One-folder workspace may remain eligible for quick-shell convenience.
- Configured max-open size and excluded extensions are enforced natively.

## Functionalities

- `logical_target` — owned by this spec.
- `scan_scripts` — owned by this spec.
- `scan_workspace_entries` — owned by this spec.
- `read_script` — owned by this spec.
- `write_script` — owned by this spec.
- `run_script` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `logical_target` | Resolve logical namespace to folder+relative path. | Select exactly one real root. | Split first segment and look up saved folder ID. | Before all workspace IO/run. |
| `scan_scripts` | Aggregate scripts from all roots. | Composite script discovery. | Scan each existing folder and namespace results. | Script refresh. |
| `scan_workspace_entries` | Page folder-scoped entries. | Bound tree IO. | Resolve target then page scan. | Expand/show more. |
| `read_script` | Read safe viewable file. | Viewer/editor content. | Resolve target then `read_viewable_excluding`. | Open file. |
| `write_script` | Write safe editable file. | Editor save. | Resolve target then `write_editable`. | Save file. |
| `run_script` | Run file or open folder terminal. | Execution/terminal functionality. | Resolve safe runnable/cwd then launch RDP/ad-hoc shell. | Run/Open Terminal. |

## State and data

- Workspace ID
- Logical path
- Resolved WorkspaceFolder
- Canonical target/cwd
- Page offset/limit
- Settings safety policy

## Errors and edge cases

- Empty/unknown folder target, unavailable root, traversal, disallowed type or oversize file returns error.

## Security and invariants

- Renderer cannot supply an absolute path as workspace operation authority.
- Canonical containment is checked in Rust.

## Verification

- Workspace IPC edge tests
- Safepath tests
- Scan paging tests
- Script/run tests

## Source map

- `src-tauri/src/workspace.rs`
- `crates/app-core/src/workspace_model.rs`
- `crates/app-core/src/safepath.rs`
- `crates/app-core/src/workspace_scan.rs`
