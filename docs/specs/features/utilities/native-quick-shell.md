---
id: feature-native-quick-shell
status: current
area: utilities
navigation: "New Terminal / native utilities"
platforms:
  - desktop
  - tauri
tags:
  - shell
  - launcher
  - logs
  - native
related:
  - feature-terminal-lifecycle
  - feature-workspace-operations
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Native Quick Shell

## Description

Defines ad-hoc Quick Shell plus small native utilities such as launcher shims, log reveal/clear and app version.

## What

Quick Shell creates a temporary native-resolvable connection/session from a supported local shell, optionally using an unambiguous one-folder workspace cwd. Utilities expose narrow app-owned OS actions.

## Why

Users need fast terminals and diagnostics while executable/path ownership remains native; multi-folder workspaces must not silently choose a cwd.

## How

Native shell probe reports supported shells; `open_quick_shell` creates temporary identity and validates optional workspace cwd. Launcher/log/version helpers operate on known app paths/generated content.

## When

On New Terminal, external shell-open readiness, launcher setup, log actions or version query.

## Behavior

- Multi-folder workspace is not eligible for implicit Quick Shell cwd.
- One-folder workspace may provide cwd.
- Shell choice comes from native-supported set.

## Functionalities

- `available_shells` / `list_available_shells` — owned by this spec.
- `quick_shell_request` — owned by this spec.
- `open_quick_shell` — owned by this spec.
- `shells_ready` / `shells_release` — owned by this spec.
- `setup_launcher` — owned by this spec.
- `reveal_log` / `clear_log` / `get_version` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `available_shells` / `list_available_shells` | Probe supported local shells. | Renderer cannot know installed executables. | Native path/executable detection. | Shell selector load. |
| `quick_shell_request` | Build ad-hoc shell request. | Testable shell/workspace cwd policy. | Resolve shell and optional one-folder workspace. | Quick shell open. |
| `open_quick_shell` | Register/open temporary shell connection. | Backend-resolvable runtime identity. | Create temp connection and shell-open flow. | User confirms shell. |
| `shells_ready` / `shells_release` | Manage shell-open readiness/temp identity. | Cold-start queue and cleanup. | Flush pending/register release. | Renderer ready/session done. |
| `setup_launcher` | Write known launcher shims. | CLI/shell integration. | Resolve app bin path and generated script content. | Launcher setup. |
| `reveal_log` / `clear_log` / `get_version` | Diagnostics/metadata utilities. | Small native app services. | Operate on app-owned paths/metadata. | User/system utility action. |

## State and data

- Available shells
- Temporary connection registry
- Shell-open readiness
- App launcher/log paths
- Version

## Errors and edge cases

- Unsupported shell/unknown or ambiguous workspace/native filesystem error returns error.

## Security and invariants

- No arbitrary renderer executable choice.
- Utility file operations target app-owned/known paths.

## Verification

- Adhoc/shell-probe/launcher/app-utils tests
- workspace quick-shell utility tests

## Source map

- `src-tauri/src/adhoc.rs`
- `src-tauri/src/shell_probe.rs`
- `src-tauri/src/launcher.rs`
- `src-tauri/src/app_utils.rs`
- `ui/components/LocalShellSelect.tsx`
