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

Defines settings defaults/persistence, shortcut preferences, theme/customization state, appearance configuration, and update settings presentation.

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
- Terminal toolbar actions default to all supported header/footer options enabled, including Copy output. Per-pane customization and global settings use accessible switches (role=switch, aria-checked); saved per-connection selections and action order remain authoritative.
- Theme/update state have separate persistence concerns.
- The Compact built-in is replaced by **TLR** (`terminal-paper` ID) with ivory/graphite/amber light mode and designed warm graphite dark mode. The renderer migrates `compact` and legacy ClickHouse selections to Terminal Paper, and obsolete `volt-agent` selections to Tokyo Night, including per-connection overrides. A saved user theme with an old ID is never overwritten or automatically reselected.
- ClickHouse was previously renamed to Compact, and Volt Agent is removed from bundled themes. Old user-authored overrides with those retired IDs remain on disk but are not shown in the theme picker; their active selections migrate to TLR or Tokyo Night.
- General settings persist the default-workspace preference (`unset`/home/workspace/folder) consumed by the new-terminal targeting chain.
- The Settings modal's Artwork tab is renamed to **Appearance** (retaining backwards compatibility with the `artwork` tab identifier), with a 4-column responsive grid of compact art preview cards.
- An accessible toggle switch "Use different color for each terminal pane" in Appearance settings allows toggling multi-pane color assignments (default ON). When disabled, all terminal panes adopt the current theme's accent color (`var(--theme-accent)`).
- The Settings modal navigation sidebar width is expanded to 14rem (`w-56`) and the modal container widened to 922px (`max-w-[922px]`), accommodating new tabs such as Appearance and Data.

## Functionalities

- `defaults` / `default_shortcuts` — owned by this spec.
- `merge_shallow` — owned by this spec.
- `read_settings` / `save_settings` — owned by this spec.
- `ThemeRemixModal` — owned by this spec.
- `list_themes` / `save_theme` / `delete_theme` — owned by this spec.
- `themeCssVars` / `applyThemeVars` — owned by this spec.
- `UpdateSettings` — owned by this spec.
- `paneIdentity` / `setDifferentPaneColors` / `isDifferentPaneColors` — owned by this spec.
- `CustomArtSettings` / `ArtCard` — owned by this spec.

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
| `paneIdentity` / `setDifferentPaneColors` | Provide unique color/shape per pane index or uniform theme accent. | Visual distinction across multi-pane layouts or unified theme accent styling. | Evaluates `differentPaneColorsEnabled` flag; falls back to theme accent when false. | Header, tab, and pane rendering. |
| `CustomArtSettings` | Render appearance and custom art configuration. | Manage pane colors and idle/loading artwork slots. | Hosts "Use different color for each terminal pane" toggle and 4-column compact art preview cards. | When Appearance settings tab is open. |

## State and data

- Effective settings
- Shortcut map
- Theme selection/draft
- CSS/terminal palette
- Update state
- `differentPaneColors` preference

## Errors and edge cases

- Corrupt/missing settings follow fallback/error policy; theme save/delete/update failures surface to UI.

## Security and invariants

- File-safety-affecting settings are still clamped/validated at consuming native boundary.
- Theme IDs cannot escape theme storage.

## Verification

- Settings/theme Rust tests
- Settings/theme/update component tests
- Shortcut/theme utility tests
- `ui/__tests__/paneIdentity.test.ts`

## Source map

- `src-tauri/src/settings.rs`
- `src-tauri/src/themes.rs`
- `ui/components/GeneralSettings.tsx`
- `ui/components/ThemeRemixModal.tsx`
- `ui/components/UpdateSettings.tsx`
- `ui/components/CustomArtSettings.tsx`
- `ui/components/SettingsModal.tsx`
- `ui/paneIdentity.ts`
- `src-tauri/builtinThemes/terminalPaper.json`
- `ui/terminalPaper.css`
- `ui/utils/themeMigration.ts`
- `ui/components/themeRemix/ThemePreview.tsx`

- Manual update checks use the official `hainguyenh/OmniTerm` latest GitHub Release API. Manual installer/portable actions open the specific asset from that checked release in the system browser, without pretending to install silently. Native signed updates remain separate; release-link validation is enforced by Rust. The update summary is constrained to a readable text width.
- Terminal toolbar switch tracks use `rounded-md` (`--theme-rounded-md`) and thumbs use `rounded-sm` (`--theme-rounded-sm`): they follow the current theme, including square corners in TLR. No hardcoded pill-radius exception is allowed for toolbar switches; only semantic status dots retain their circular shape. Compact layout prevents switch/label/reorder overlap in the scrollable customization popup.
