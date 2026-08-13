---
id: architecture-security-data
status: current
area: architecture
navigation: "Internal"
platforms:
  - desktop
  - tauri
tags:
  - security
  - filesystem
  - persistence
related:
  - component-rust-filesystem-launch
  - feature-connection-launch-secrets
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Architecture Security Data

## Description

Defines OmniTerm trust boundaries for paths, persisted/imported JSON, secrets, URLs, file size/type policies and process launch requests.

## What

Untrusted renderer/persisted/import data is converted into validated native targets before filesystem/process effects.

## Why

Path strings, workspace files and saved JSON are user-controlled and must never become implicit authority for arbitrary host access.

## How

Core safepath helpers canonicalize and enforce containment; workspace logical IDs resolve to a declared folder; persistence validates schemas; connection saves scrub secrets; plugin URLs and launch choices are allowlisted/resolved natively.

## When

Before any file read/write/run, terminal cwd, connection/process launch, import, persistence load/write or plugin external action.

## Behavior

- Unknown folder IDs fail before filesystem access.
- Logical IDs are not native paths.
- Unavailable roots remain saved but operations fail safely.
- Passwords are not persisted.

## Functionalities

- `safe_viewable_path*` — owned by this spec.
- `safe_editable_path` — owned by this spec.
- `safe_runnable_path` — owned by this spec.
- `validate_workspace_list` — owned by this spec.
- `scrub_stored_secrets` — owned by this spec.
- `is_allowed_plugin_url` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `safe_viewable_path*` | Authorize contained viewable file. | Prevent traversal/disallowed reads. | Canonical containment + type/exclusion checks. | Read/view. |
| `safe_editable_path` | Authorize contained editable file. | Prevent arbitrary writes. | Canonical containment + editable-kind check. | Save. |
| `safe_runnable_path` | Authorize contained runnable file. | Prevent arbitrary process launch. | Canonical containment + runnable-kind check. | Run. |
| `validate_workspace_list` | Validate persisted hierarchy/folder/pins. | Reject corrupt state. | Check IDs/references/cycles. | Workspace load/write. |
| `scrub_stored_secrets` | Remove connection secrets before storage. | Avoid credential-at-rest leakage. | Transform profile data before serialization. | Connection save/export. |
| `is_allowed_plugin_url` | Gate plugin URL target. | Block unsafe schemes/targets. | Explicit URL policy. | Plugin URL request. |

## State and data

- Canonical roots/targets
- Configured max-open size/exclusions
- Validated workspace hierarchy
- Sanitized connection records

## Errors and edge cases

- Traversal/disallowed/oversize targets return errors.
- Corrupt persisted/imported JSON is rejected rather than silently trusted.

## Security and invariants

- Folder IDs cannot contain `/` or `\`.
- No runtime `unwrap`/`expect` at untrusted production boundaries.

## Verification

- Safepath tests
- Workspace validation/migration tests
- Password persistence audit
- Plugin URL tests

## Source map

- `crates/app-core/src/safepath.rs`
- `crates/app-core/src/workspace_model.rs`
- `src-tauri/src/connections.rs`
- `src-tauri/src/app_utils.rs`
