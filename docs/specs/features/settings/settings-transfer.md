---
id: feature-settings-transfer
status: current
area: settings
navigation: "Settings > export / import"
platforms:
  - desktop
  - tauri
tags:
  - settings
  - backup
  - transfer
  - themes
related:
  - feature-settings-themes-updates
  - feature-workspace-import
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Settings Transfer

## Description

Defines whole-settings export/import as one backend-built envelope with merge-or-replace import strategies and validate-before-write safety.

## What

Export serializes every backend-backed settings section (preferences, shortcuts, custom themes) into a single timestamped envelope. Import applies an envelope either by merging (existing values win, new entries append) or replacing outright, returning a per-section report.

## Why

Users move between machines and builds; per-section hand-copying is lossy, and an import that half-applies on a bad theme id would leave the app in a mixed state worse than either outcome.

## How

`export_settings` gathers sections through each owning service and stamps an RFC 3339 timestamp. `import_settings` validates everything first — theme ids against the live set, structure against section shapes — then writes via raw writers (`write_settings_raw`, `write_user_theme`) or clears/rewrites the theme store (`clear_user_themes`). The renderer's normal `save_settings` keeps its merge semantics; only transfer paths bypass it.

## When

On explicit export/import actions in Settings, such as migration to a new machine or sharing a configuration bundle.

## Behavior

- One envelope contains every supported section; unknown sections are ignored on import.
- `merge` strategy never overwrites an existing value; `replace` wins outright.
- Validation precedes any write: a rejected theme id aborts the whole import with no partial state.
- Import reports counts per section so the UI can show what changed.

## Functionalities

- `export_settings` — owned by this spec.
- `import_settings` — owned by this spec.
- `write_settings_raw` — owned by this spec.
- `write_user_theme` / `user_theme_files` / `clear_user_themes` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `export_settings` | Build one settings envelope. | Lossless machine-to-machine moves. | Gather sections from owning services, stamp RFC 3339 time. | Export action. |
| `import_settings` | Apply an envelope. | Restore or blend a configuration. | Validate all sections, then merge or replace per strategy. | Import action. |
| `write_settings_raw` | Write settings without merge semantics. | Import must be able to replace wholesale. | Serialize validated tree to app data. | Import path only. |
| `write_user_theme` / `user_theme_files` / `clear_user_themes` | Persist/list/reset custom themes for transfer. | Themes ride in the same envelope. | Theme-file operations behind validated ids. | Import/export of the theme section. |

## State and data

- Transfer envelope (sections + timestamp)
- Import strategy (`merge` / `replace`)
- Per-section imported-count report

## Errors and edge cases

- Unknown/corrupt sections and invalid theme ids fail the import before any write.
- Filesystem write failures surface as errors with no partial envelope applied.

## Security and invariants

- Envelope content passes each consuming boundary's existing validation; import grants no new file/path authority.
- Secrets are not part of the envelope beyond what settings already persist.

## Verification

- Settings transfer unit tests (`settings_transfer_tests.rs`)
- IPC runtime command tests

## Source map

- `src-tauri/src/settings_transfer.rs`
- `src-tauri/src/settings.rs`
- `src-tauri/src/themes.rs`
