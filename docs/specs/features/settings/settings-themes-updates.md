---
id: feature-settings-themes-updates
status: current
area: settings
navigation: "Settings"
platforms:
  - desktop
  - tauri
tags:
  - settings
  - themes
  - updates
  - appearance
related:
  - component-frontend-settings-plugins
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Settings Themes Updates

## Description

Defines settings defaults/persistence, shortcut preferences, theme/customization state and update settings presentation.

## What

Effective settings merge current defaults with persisted top-level overrides. Appearance maps theme/settings to renderer/terminal visuals. Update controls are a separate service surfaced in Settings.

## Why

Centralized defaults and theme projection prevent feature-specific config drift; update lifecycle should not contaminate theme persistence.

## How

Native settings read/write app data; renderer components edit effective/draft values. Theme commands validate/list/save/delete custom themes; CSS helpers project colors/fonts. Update settings bind update APIs/state.

## When

At app startup, settings load/save, appearance changes, theme remix, custom-art/blur changes or update settings use.

## Behavior

- Missing settings fall back to defaults.
- Theme identifiers validate before file operations.
- Theme/update state have separate persistence concerns.

## Functionalities

- `defaults` / `default_shortcuts` — owned by this spec.
- `merge_shallow` — owned by this spec.
- `read_settings` / `save_settings` — owned by this spec.
- `ThemeRemixModal` — owned by this spec.
- `list_themes` / `save_theme` / `delete_theme` — owned by this spec.
- `themeCssVars` / `applyThemeVars` — owned by this spec.
- `UpdateSettings` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `defaults` / `default_shortcuts` | Build default settings. | Stable baseline/new keys. | Return default JSON/mapping. | Settings init. |
| `merge_shallow` | Merge persisted overrides. | Forward-compatible new defaults. | Overlay top-level values. | Read settings. |
| `read_settings` / `save_settings` | Load/persist settings. | Durable preferences. | App-data JSON. | Startup/change. |
| `ThemeRemixModal` | Edit/preview custom theme. | Visual customization. | Maintain draft and call theme save. | Remix open. |
| `list_themes` / `save_theme` / `delete_theme` | Manage themes. | Appearance persistence. | Validated custom theme file operations. | Theme actions. |
| `themeCssVars` / `applyThemeVars` | Project effective theme to CSS. | Consistent renderer styling. | Resolve fields and write CSS variables. | Theme apply. |
| `UpdateSettings` | Render update preferences/actions. | Expose update service. | Bind update state/API. | Update settings route. |

## State and data

- Effective settings
- Shortcut map
- Theme selection/draft
- CSS/terminal palette
- Update state

## Errors and edge cases

- Corrupt/missing settings follow fallback/error policy; theme save/delete/update failures surface to UI.

## Security and invariants

- File-safety-affecting settings are still clamped/validated at consuming native boundary.
- Theme IDs cannot escape theme storage.

## Verification

- Settings/theme Rust tests
- Settings/theme/update component tests
- Shortcut/theme utility tests

## Source map

- `src-tauri/src/settings.rs`
- `src-tauri/src/themes.rs`
- `ui/components/GeneralSettings.tsx`
- `ui/components/ThemeRemixModal.tsx`
- `ui/components/UpdateSettings.tsx`
