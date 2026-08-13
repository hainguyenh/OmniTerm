---
id: feature-connection-management
status: current
area: connections
navigation: "Connections"
platforms:
  - desktop
  - tauri
tags:
  - connections
  - crud
  - import-export
related:
  - feature-connection-launch-secrets
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Connection Management

## Description

Defines reusable connection profile creation, editing, deletion, import/export and global/workspace scope presentation.

## What

Connection profiles store destination/configuration metadata independently from live terminal/RDP session state.

## Why

Users need reusable destinations and project-scoped profiles without coupling them to current process lifetime.

## How

Renderer forms produce structured profile data; native connection services load/save/import/export JSON and sanitize persisted secrets. Workspace-scoped profiles use the workspace connection service.

## When

When Connections opens or a user creates, edits, deletes, imports or exports a profile.

## Behavior

- Connection ID is stable profile identity.
- Workspace/global scope is explicit.
- Editing updates matching profile instead of duplicating ID.

## Functionalities

- `ConnectionForm` — owned by this spec.
- `ConnectionAdvanced` — owned by this spec.
- `load_connections` — owned by this spec.
- `save_connections` — owned by this spec.
- `import_json` / `import_file` — owned by this spec.
- `export_json` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `ConnectionForm` | Edit profile fields and scope. | One consistent profile UX. | Controlled fields submit structured data. | Create/edit. |
| `ConnectionAdvanced` | Expose type-specific advanced fields. | Keep common form concise. | Conditionally render by connection type. | Advanced opened. |
| `load_connections` | Load global saved profiles. | Restore user destinations. | Read/parse app-data JSON. | Startup/view load. |
| `save_connections` | Persist global profiles. | Durable configuration. | Scrub secrets then serialize/write. | Profile mutation. |
| `import_json` / `import_file` | Import profile data. | Backup/transfer. | Parse imported JSON and map outcome. | Import action. |
| `export_json` | Serialize exportable profiles. | Backup/share. | Serialize sanitized records. | Export action. |

## State and data

- Profile list
- Edit draft
- Scope
- Import/export result

## Errors and edge cases

- Invalid import/required fields return errors; failed save does not claim success.

## Security and invariants

- Runtime passwords are not persisted.
- Import is data-only and never executed.

## Verification

- Connection Rust command/persistence tests
- Connection form tests
- Password persistence audit

## Source map

- `ui/components/ConnectionForm.tsx`
- `ui/components/ConnectionAdvanced.tsx`
- `src-tauri/src/connections.rs`
- `src-tauri/src/workspace_connections.rs`
