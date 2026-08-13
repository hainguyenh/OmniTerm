---
id: feature-file-browser-view-editor
status: current
area: files
navigation: "Workspace tree > file"
platforms:
  - desktop
  - tauri
tags:
  - files
  - tree
  - viewer
  - editor
  - markdown
related:
  - architecture-security-data
  - feature-workspace-operations
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature File Browser View Editor

## Description

Defines lazy file navigation plus safe view/edit and Markdown preview behavior for workspace content.

## What

Files are discovered under saved workspace roots, identified by logical paths, read only when viewable and written only when editable.

## Why

Large repositories require paging and file access must remain contained, type-gated and size-bounded.

## How

Folder skeleton/paged scans populate renderer tree. Opening/saving invokes workspace read/write commands, which resolve a real folder and call safepath helpers. Markdown rendering consumes already-authorized returned text.

## When

When browsing/expanding files, opening preview/editor, saving edits or searching/filtering tree content.

## Behavior

- Directory skeleton can render before full file list.
- View and edit capability are separate.
- Excluded viewable extensions and max file size are enforced natively.

## Functionalities

- `scan_folders` — owned by this spec.
- `scan_entries_page_excluding` — owned by this spec.
- `FileBrowser` — owned by this spec.
- `read_script` — owned by this spec.
- `write_script` — owned by this spec.
- `MarkdownPreview` — owned by this spec.
- `ScriptViewer` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `scan_folders` | Discover directory skeleton. | Fast initial tree. | Enumerate directories only. | Workspace load. |
| `scan_entries_page_excluding` | Page folder entries. | Bound IPC/render work. | Validate relative dir and slice classified entries. | Expand/show more. |
| `FileBrowser` | Render navigable file hierarchy. | File navigation UX. | Consume tree/expand/open callbacks. | Browser visible. |
| `read_script` | Read authorized text. | Viewer/editor content. | Resolve logical target then safe bounded read. | Open file. |
| `write_script` | Write authorized text. | Editor save. | Resolve target then safe editable write. | Save. |
| `MarkdownPreview` | Render Markdown from authorized content. | Rich document reading. | Renderer Markdown render pipeline. | Markdown preview. |
| `ScriptViewer` | Render file viewer/editor state. | Unified open/edit workflow. | Manage content/dirty/save presentation. | Supported file selected. |

## State and data

- Expanded dirs
- Paged entries
- Logical path
- Loaded content
- Dirty state
- File kind

## Errors and edge cases

- Unavailable/removed/oversize/disallowed/traversal target returns error.

## Security and invariants

- Canonical containment on every native read/write.
- Markdown content does not grant native authority.

## Verification

- Workspace scan/paging tests
- Safepath view/edit tests
- ScriptViewer/Markdown tests

## Source map

- `crates/app-core/src/workspace_scan.rs`
- `crates/app-core/src/workspace_scan_paging.rs`
- `crates/app-core/src/safepath.rs`
- `ui/components/FileBrowser.tsx`
- `ui/components/ScriptViewer.tsx`
