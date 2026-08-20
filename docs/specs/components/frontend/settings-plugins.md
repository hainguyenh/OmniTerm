---
id: component-frontend-settings-plugins
status: current
area: components-frontend
navigation: "Renderer > Settings / Plugins"
platforms:
  - renderer
  - desktop
tags:
  - react
  - settings
  - themes
  - plugins
related:
  - feature-settings-themes-updates
  - feature-plugin-lifecycle-runtime
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Component Frontend Settings Plugins

## Description

Catalog of renderer components for general settings, appearance/theme remix, custom art/blur, updates and plugin lifecycle.

## What

Components edit renderer drafts/effective settings and request native persistence/lifecycle actions through APIs.

## Why

Visual/configuration UI should be reusable and testable while file/package operations remain native.

## How

Controlled components bind settings/theme/plugin hooks and call `omnitermAPI` actions. Theme helpers derive preview/effective colors without native filesystem access.

## When

When Settings/Plugin surfaces are open or user changes/saves customization/lifecycle options.

## Behavior

- Draft UI state is not claimed persisted until native action succeeds.
- Theme/plugin/custom-art file operations stay native.

## Functionalities

- `SettingsModal` — owned by this spec.
- `GeneralSettings` — owned by this spec.
- `AppearanceMenu` — owned by this spec.
- `ThemeRemixModal` — owned by this spec.
- `BlurSettingsOverlay` — owned by this spec.
- `CustomArtSettings` — owned by this spec.
- `UpdateSettings` — owned by this spec.
- `PluginManager` — owned by this spec.
- `ToggleRow` — owned by this spec.
- `PasswordHelpField` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `SettingsModal` | Render consolidated settings modal dialog. | Modular tabbed configuration UX with categorized settings. | Renders vertical-tabbed layout for General, Appearance, Plugins, Updates, and Shortcuts. | Settings modal active. |
| `GeneralSettings` | Render general preferences. | Main configuration UX. | Bind effective/draft values and save callbacks. | Settings route. |
| `AppearanceMenu` | Render appearance choices. | Fast visual selection. | Bind theme/mode state. | Appearance control. |
| `ThemeRemixModal` | Edit/preview custom theme. | Advanced visual customization. | Maintain draft and invoke theme save. | Remix open. |
| `BlurSettingsOverlay` | Configure blur behavior. | Focused appearance control. | Bind blur hook/settings. | Blur settings. |
| `CustomArtSettings` | Manage custom art. | User personalization. | Invoke custom-art upload/get/remove. | Custom art settings. |
| `UpdateSettings` | Render update options/state. | Expose update service. | Bind update API/state. | Update route. |
| `PluginManager` | Render plugin descriptors/actions. | Plugin administration. | Invoke install/remove/restart APIs. | Plugins route. |
| `ToggleRow` | Reusable labeled boolean control. | Consistent settings UI. | Controlled checkbox/toggle row. | Boolean preference. |
| `PasswordHelpField` | Render secret field and storage guidance. | Communicate password persistence rule. | Controlled input/help. | Connection secret field. |

## State and data

- Settings/theme drafts
- Custom art/blur state
- Update state
- Plugin descriptors

## Errors and edge cases

- Save/install/upload failures remain visible and do not optimistically claim durable success.

## Security and invariants

- Password help reinforces non-persistence; native side effects stay behind bridge.

## Verification

- Settings/theme/plugin component tests
- hook/bridge contract tests

## Source map

- `ui/components/SettingsModal.tsx`
- `ui/components/GeneralSettings.tsx`
- `ui/components/ThemeRemixModal.tsx`
- `ui/components/UpdateSettings.tsx`
- `ui/components/PluginManager.tsx`
- `ui/components/CustomArtSettings.tsx`
