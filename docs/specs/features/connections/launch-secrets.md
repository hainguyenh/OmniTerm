---
id: feature-connection-launch-secrets
status: current
area: connections
navigation: "Connections > Open / Password"
platforms:
  - desktop
  - tauri
tags:
  - connections
  - launch
  - security
  - ssh
  - rdp
related:
  - architecture-security-data
  - feature-terminal-lifecycle
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Connection Launch Secrets

## Description

Defines connection-to-session launch resolution and the runtime-only treatment of secret values.

## What

Opening a profile resolves known connection metadata into local shell, SSH or RDP behavior; sensitive password values may participate transiently but are excluded from durable connection JSON.

## Why

Executable/client selection must be native and credentials must not leak through app/project persistence.

## How

Native resolver looks up known connection IDs, validates required clients/shells and builds launch details. `scrub_stored_secrets` removes secret fields before save/export; `PasswordHelpField` communicates persistence behavior.

## When

When opening a connection, preparing SSH/RDP/local session, or saving/exporting a profile containing password input.

## Behavior

- Unknown connection IDs fail rather than guessing.
- Native client availability is checked before launch.
- Password may exist transiently but is omitted from saved/exported records.

## Functionalities

- `resolve_connection_by_id` — owned by this spec.
- `resolve_local_launch` — owned by this spec.
- `prepare_ssh_session` — owned by this spec.
- `connect_rdp` / `launch_rdp` — owned by this spec.
- `scrub_stored_secrets` — owned by this spec.
- `PasswordHelpField` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `resolve_connection_by_id` | Resolve known connection identity. | Prevent arbitrary renderer launch config. | Lookup persisted/temporary profile and dispatch. | Open session. |
| `resolve_local_launch` | Build local shell launch. | Central shell/executable policy. | Resolve supported executable/cwd/env. | Local launch. |
| `prepare_ssh_session` | Prepare SSH invocation/session. | Keep SSH client/platform behavior native. | Require client and build structured arguments. | SSH launch. |
| `connect_rdp` / `launch_rdp` | Start RDP flow. | RDP is separate from PTY. | Generate/launch native RDP configuration/client. | RDP open. |
| `scrub_stored_secrets` | Remove secret values before persistence. | Avoid plaintext credentials at rest. | Transform connection record before serialization. | Save/export. |
| `PasswordHelpField` | Show password persistence guidance. | Set user expectation. | Render controlled secret field/help. | Password field visible. |

## State and data

- Connection metadata
- Temporary/runtime password
- Resolved executable/client
- Session launch request

## Errors and edge cases

- Missing client, invalid connection or launch failure returns error.

## Security and invariants

- No plaintext password persistence.
- Executable/client choice is resolved natively.

## Verification

- PTY resolve/RDP tests
- Password persistence audit
- Connection launch tests

## Source map

- `src-tauri/src/pty_resolve.rs`
- `src-tauri/src/rdp_embed.rs`
- `src-tauri/src/connections.rs`
- `ui/components/PasswordHelpField.tsx`
