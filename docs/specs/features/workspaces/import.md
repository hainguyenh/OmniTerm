---
id: feature-workspace-import
status: current
area: workspaces
navigation: "Workspaces > Import workspace"
platforms:
  - desktop
  - tauri
tags:
  - workspace
  - import
  - vscode
  - vscodium
related:
  - feature-workspace-model-persistence
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Workspace Import

## Description

Defines importing VS Code/VSCodium multi-root workspace files while intentionally ignoring editor-specific configuration.

## What

OmniTerm accepts both `.code-workspace` and `.workspace`, imports the filename-derived workspace name and each usable local folder name/path only.

## Why

Users can reuse existing project grouping without importing VS Code tasks/settings/extensions/launch semantics into OmniTerm.

## How

Renderer opens a filtered picker. Native command caps the input at 1 MB, parser reads `folders[]`, resolves relative paths against the workspace-file directory, canonicalizes existing directories, preserves explicit folder names, de-duplicates paths, skips unusable entries and fails only if none remain.

## When

When the user selects Import Workspace and chooses an accepted file.

## Behavior

- Explicit editor folder `name` wins; otherwise basename is used.
- Relative folder paths resolve from import file location.
- Stale/missing folder entries are skipped if another valid folder exists.
- Tasks/settings/extensions/launch data are ignored.

## Functionalities

- `workspaceAPI.importFile` — owned by this spec.
- `parse_workspace_import` — owned by this spec.
- `import_workspace_file` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `workspaceAPI.importFile` | Pick editor workspace file and invoke native import. | Renderer must not read arbitrary native files. | Use Tauri dialog filters and `import_workspace_file`. | Import action. |
| `parse_workspace_import` | Parse editor workspace into name/folders. | Keep editor schema separate from OmniTerm schema. | Resolve/canonicalize/dedupe usable folder paths. | Native import. |
| `import_workspace_file` | Bound read and persist imported workspace. | Own native file/persistence side effects. | Check extension/size, parse, regenerate OmniTerm folder IDs, save. | After picker selection. |

## State and data

- Import file path/size/content
- Parsed folder entries
- Canonical local dirs
- Generated folder IDs
- New root order

## Errors and edge cases

- Unsupported extension, invalid JSON, >1MB file, or zero usable local folders returns a clear error.

## Security and invariants

- Import never executes embedded editor configuration.
- Only existing local directories become roots.

## Verification

- Core import parser tests
- Tauri workspace import tests
- Renderer bridge/picker tests

## Source map

- `ui/workspaceAPI.ts`
- `crates/app-core/src/workspace_model.rs`
- `src-tauri/src/workspace.rs`
