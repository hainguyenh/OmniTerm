---
id: component-frontend-source-inventory
status: current
area: components-frontend
navigation: "Renderer source inventory"
platforms:
  - renderer
  - desktop
tags:
  - components
  - source-inventory
  - traceability
related:
  - component-frontend-shell-layout
  - component-frontend-workspace
  - component-frontend-hooks-utilities
properties:
  normative: true
  detail_level: source-module
  update_policy: code-and-spec-together
---
# Component Frontend Source Inventory

## Description

Traceability inventory for every top-level TypeScript/TSX module under `ui/components`, `ui/hooks`, and `ui/utils`. Feature-specific specs explain deep behavior; this inventory ensures no renderer module disappears from the specification map.

## What

Maps every renderer source module and its exported symbols to a What / Why / How / When responsibility statement.

## Why

A source inventory closes documentation gaps: new components/hooks/utilities must be routed into the specs instead of silently existing outside the software documentation.

## How

Rows are derived from the current source tree and grouped by the module’s role. The owning detailed specs remain normative for behavior; this file is normative for source traceability.

## When

Update whenever a top-level renderer component, hook or utility module is added, renamed, removed, or changes responsibility.

## Behavior

- Every top-level `ui/components`, `ui/hooks`, and `ui/utils` TypeScript/TSX module appears here.
- Exported public symbols are named where the module exposes them.
- Private implementation helpers stay documented through their owning module/spec rather than being treated as public contract.

## Functionalities

- Renderer module traceability
- Exported symbol routing
- Documentation coverage gate

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `ActivityView`<br>`ui/components/ActivityBar.tsx` | Application UI component/module; source exports: ActivityView. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `AppearanceMenu` module<br>`ui/components/AppearanceMenu.tsx` | Settings/customization component/module; source exports: module-owned/private symbols. | Keep configuration UX focused and reusable | Binds controlled settings/customization state to bridge actions | When settings/customization UI is active |
| `BlurSettingsOverlay`<br>`ui/components/BlurSettingsOverlay.tsx` | Settings/customization component/module; source exports: BlurSettingsOverlay. | Keep configuration UX focused and reusable | Binds controlled settings/customization state to bridge actions | When settings/customization UI is active |
| `CloseConfirmModal` module<br>`ui/components/CloseConfirmModal.tsx` | Application UI component/module; source exports: module-owned/private symbols. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `CommandPalette`<br>`ui/components/CommandPalette.tsx` | Application UI component/module; source exports: CommandPalette. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `ConfirmDialog` module<br>`ui/components/ConfirmDialog.tsx` | Application UI component/module; source exports: module-owned/private symbols. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `ConnectingOverlay` module<br>`ui/components/ConnectingOverlay.tsx` | Session UI component/module; source exports: module-owned/private symbols. | Separate runtime presentation from native process ownership | Renders session state and invokes supplied/native bridge actions | When a session is visible or changes |
| `ConnectionAdvanced` module<br>`ui/components/ConnectionAdvanced.tsx` | Application UI component/module; source exports: module-owned/private symbols. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `ConnectionForm` module<br>`ui/components/ConnectionForm.tsx` | Application UI component/module; source exports: module-owned/private symbols. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `CustomArtSettings` module<br>`ui/components/CustomArtSettings.tsx` | Settings/customization component/module; source exports: module-owned/private symbols. | Keep configuration UX focused and reusable | Binds controlled settings/customization state to bridge actions | When settings/customization UI is active |
| `DetachedPlaceholder` module<br>`ui/components/DetachedPlaceholder.tsx` | Application UI component/module; source exports: module-owned/private symbols. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `DetachedTerminalWindow` module<br>`ui/components/DetachedTerminalWindow.tsx` | Session UI component/module; source exports: module-owned/private symbols. | Separate runtime presentation from native process ownership | Renders session state and invokes supplied/native bridge actions | When a session is visible or changes |
| `DialogHost` module<br>`ui/components/DialogHost.tsx` | Application UI component/module; source exports: module-owned/private symbols. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `FileBrowser` module<br>`ui/components/FileBrowser.tsx` | Application UI component/module; source exports: module-owned/private symbols. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `FullscreenRestoreControl`<br>`ui/components/FullscreenRestoreControl.tsx` | Application UI component/module; source exports: FullscreenRestoreControl. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `GeneralSettings` module<br>`ui/components/GeneralSettings.tsx` | Settings/customization component/module; source exports: module-owned/private symbols. | Keep configuration UX focused and reusable | Binds controlled settings/customization state to bridge actions | When settings/customization UI is active |
| `LocalShellSelect`<br>`ui/components/LocalShellSelect.tsx` | Application UI component/module; source exports: LocalShellSelect. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `MainLayout` module<br>`ui/components/MainLayout.tsx` | Application UI component/module; source exports: module-owned/private symbols. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `MainLayoutOverlays`<br>`ui/components/MainLayoutOverlays.tsx` | Application UI component/module; source exports: MainLayoutOverlays. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `MainLayoutView`<br>`ui/components/MainLayoutView.tsx` | Application UI component/module; source exports: MainLayoutView. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `MarkdownPreview` module<br>`ui/components/MarkdownPreview.tsx` | Application UI component/module; source exports: module-owned/private symbols. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `OverlayBar` module<br>`ui/components/OverlayBar.tsx` | Application UI component/module; source exports: module-owned/private symbols. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `PaneHeader` module<br>`ui/components/PaneHeader.tsx` | Application UI component/module; source exports: module-owned/private symbols. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `PaneResizers`<br>`ui/components/PaneResizers.tsx` | Application UI component/module; source exports: PaneResizers. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `PasswordHelpField`<br>`ui/components/PasswordHelpField.tsx` | Settings/customization component/module; source exports: PasswordHelpField. | Keep configuration UX focused and reusable | Binds controlled settings/customization state to bridge actions | When settings/customization UI is active |
| `PluginManager`<br>`ui/components/PluginManager.tsx` | Settings/customization component/module; source exports: PluginManager. | Keep configuration UX focused and reusable | Binds controlled settings/customization state to bridge actions | When settings/customization UI is active |
| `RDPView` module<br>`ui/components/RDPView.tsx` | Session UI component/module; source exports: module-owned/private symbols. | Separate runtime presentation from native process ownership | Renders session state and invokes supplied/native bridge actions | When a session is visible or changes |
| `ScriptViewer` module<br>`ui/components/ScriptViewer.tsx` | Application UI component/module; source exports: module-owned/private symbols. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `SessionMetricsChips` module<br>`ui/components/SessionMetricsChips.tsx` | Session UI component/module; source exports: module-owned/private symbols. | Separate runtime presentation from native process ownership | Renders session state and invokes supplied/native bridge actions | When a session is visible or changes |
| `SessionTabItem`<br>`ui/components/SessionTabs.tsx` | Session UI component/module; source exports: SessionTabItem. | Separate runtime presentation from native process ownership | Renders session state and invokes supplied/native bridge actions | When a session is visible or changes |
| `TerminalView` module<br>`ui/components/TerminalView.tsx` | Session UI component/module; source exports: module-owned/private symbols. | Separate runtime presentation from native process ownership | Renders session state and invokes supplied/native bridge actions | When a session is visible or changes |
| `ThemeRemixModal`<br>`ui/components/ThemeRemixModal.tsx` | Settings/customization component/module; source exports: ThemeRemixModal. | Keep configuration UX focused and reusable | Binds controlled settings/customization state to bridge actions | When settings/customization UI is active |
| `TitleBar`<br>`ui/components/TitleBar.tsx` | Application UI component/module; source exports: TitleBar. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `ToggleRow`<br>`ui/components/ToggleRow.tsx` | Settings/customization component/module; source exports: ToggleRow. | Keep configuration UX focused and reusable | Binds controlled settings/customization state to bridge actions | When settings/customization UI is active |
| `UpdateSettings`, `UpdateSettingsProps`<br>`ui/components/UpdateSettings.tsx` | Settings/customization component/module; source exports: UpdateSettings, UpdateSettingsProps. | Keep configuration UX focused and reusable | Binds controlled settings/customization state to bridge actions | When settings/customization UI is active |
| `ViewGroupTabs`<br>`ui/components/ViewGroupTabs.tsx` | Application UI component/module; source exports: ViewGroupTabs. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `WaitingPane` module<br>`ui/components/WaitingPane.tsx` | Session UI component/module; source exports: module-owned/private symbols. | Separate runtime presentation from native process ownership | Renders session state and invokes supplied/native bridge actions | When a session is visible or changes |
| `WorkspaceAddConnectionButton` module<br>`ui/components/WorkspaceAddConnectionButton.tsx` | Workspace UI component/module; source exports: module-owned/private symbols. | Keep composite workspace UX split by responsibility | Consumes workspace props/state and dispatches typed callbacks | When the Workspaces surface renders or changes |
| `WorkspaceConnectionRow` module<br>`ui/components/WorkspaceConnectionRow.tsx` | Workspace UI component/module; source exports: module-owned/private symbols. | Keep composite workspace UX split by responsibility | Consumes workspace props/state and dispatches typed callbacks | When the Workspaces surface renders or changes |
| `WorkspaceContainerList`<br>`ui/components/WorkspaceContainerList.tsx` | Workspace UI component/module; source exports: WorkspaceContainerList. | Keep composite workspace UX split by responsibility | Consumes workspace props/state and dispatches typed callbacks | When the Workspaces surface renders or changes |
| `WorkspaceEmptyState` module<br>`ui/components/WorkspaceEmptyState.tsx` | Workspace UI component/module; source exports: module-owned/private symbols. | Keep composite workspace UX split by responsibility | Consumes workspace props/state and dispatches typed callbacks | When the Workspaces surface renders or changes |
| `WorkspaceFilterMenu` module<br>`ui/components/WorkspaceFilterMenu.tsx` | Workspace UI component/module; source exports: module-owned/private symbols. | Keep composite workspace UX split by responsibility | Consumes workspace props/state and dispatches typed callbacks | When the Workspaces surface renders or changes |
| `WorkspaceFilterTree` module<br>`ui/components/WorkspaceFilterTree.tsx` | Workspace UI component/module; source exports: module-owned/private symbols. | Keep composite workspace UX split by responsibility | Consumes workspace props/state and dispatches typed callbacks | When the Workspaces surface renders or changes |
| `WorkspacePanel` module<br>`ui/components/WorkspacePanel.tsx` | Workspace UI component/module; source exports: module-owned/private symbols. | Keep composite workspace UX split by responsibility | Consumes workspace props/state and dispatches typed callbacks | When the Workspaces surface renders or changes |
| `WorkspacePanelHeader` module<br>`ui/components/WorkspacePanelHeader.tsx` | Workspace UI component/module; source exports: module-owned/private symbols. | Keep composite workspace UX split by responsibility | Consumes workspace props/state and dispatches typed callbacks | When the Workspaces surface renders or changes |
| `WorkspaceRootRow`<br>`ui/components/WorkspaceRootRow.tsx` | Workspace UI component/module; source exports: WorkspaceRootRow. | Keep composite workspace UX split by responsibility | Consumes workspace props/state and dispatches typed callbacks | When the Workspaces surface renders or changes |
| `SEARCH_HINT`<br>`ui/components/WorkspaceSearchBar.tsx` | Workspace UI component/module; source exports: SEARCH_HINT. | Keep composite workspace UX split by responsibility | Consumes workspace props/state and dispatches typed callbacks | When the Workspaces surface renders or changes |
| `WorkspaceSelect`<br>`ui/components/WorkspaceSelect.tsx` | Workspace UI component/module; source exports: WorkspaceSelect. | Keep composite workspace UX split by responsibility | Consumes workspace props/state and dispatches typed callbacks | When the Workspaces surface renders or changes |
| `WorkspaceShowMore` module<br>`ui/components/WorkspaceShowMore.tsx` | Workspace UI component/module; source exports: module-owned/private symbols. | Keep composite workspace UX split by responsibility | Consumes workspace props/state and dispatches typed callbacks | When the Workspaces surface renders or changes |
| `WorkspaceTreeToolbar` module<br>`ui/components/WorkspaceTreeToolbar.tsx` | Workspace UI component/module; source exports: module-owned/private symbols. | Keep composite workspace UX split by responsibility | Consumes workspace props/state and dispatches typed callbacks | When the Workspaces surface renders or changes |
| `mintSessionId`, `MAX_PLANES`, `shortcutLabels`, `DEFAULT_SHORTCUTS`, `CtxItem`, `Grid6Icon`, `Grid8Icon`, `MainLayoutProps`<br>`ui/components/mainLayoutShared.tsx` | Application UI component/module; source exports: mintSessionId, MAX_PLANES, shortcutLabels, DEFAULT_SHORTCUTS, CtxItem, Grid6Icon, Grid8Icon, MainLayoutProps. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `useMainLayoutBase`<br>`ui/components/useMainLayoutBase.tsx` | Application UI component/module; source exports: useMainLayoutBase. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `useMainLayoutController`, `MainLayoutModel`<br>`ui/components/useMainLayoutController.ts` | Application UI component/module; source exports: useMainLayoutController, MainLayoutModel. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `useMainLayoutSessions`<br>`ui/components/useMainLayoutSessions.tsx` | Session UI component/module; source exports: useMainLayoutSessions. | Separate runtime presentation from native process ownership | Renders session state and invokes supplied/native bridge actions | When a session is visible or changes |
| `WorkspacePanelProps`, `WorkspaceConnectionTarget`<br>`ui/components/workspacePanelTypes.ts` | Application UI component/module; source exports: WorkspacePanelProps, WorkspaceConnectionTarget. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `collectDirKeys`, `buildWorkspacePanelView`, `WorkspacePanelView`<br>`ui/components/workspacePanelView.ts` | Application UI component/module; source exports: collectDirKeys, buildWorkspacePanelView, WorkspacePanelView. | Keep renderer composition modular and testable | Renders typed props/state and invokes supplied actions | When its parent surface renders |
| `useAppShortcuts`, `UseAppShortcutsInput`<br>`ui/hooks/useAppShortcuts.ts` | React hook; source exports: useAppShortcuts, UseAppShortcutsInput. | Own lifecycle/state outside presentation | Composes React state/effects/callbacks and native/pure helpers | When the owning feature is mounted or dependencies change |
| `useBlurPlugin`<br>`ui/hooks/useBlurPlugin.ts` | React hook; source exports: useBlurPlugin. | Own lifecycle/state outside presentation | Composes React state/effects/callbacks and native/pure helpers | When the owning feature is mounted or dependencies change |
| `useConnectionMeta`<br>`ui/hooks/useConnectionMeta.ts` | React hook; source exports: useConnectionMeta. | Own lifecycle/state outside presentation | Composes React state/effects/callbacks and native/pure helpers | When the owning feature is mounted or dependencies change |
| `useCustomArt`<br>`ui/hooks/useCustomArt.ts` | React hook; source exports: useCustomArt. | Own lifecycle/state outside presentation | Composes React state/effects/callbacks and native/pure helpers | When the owning feature is mounted or dependencies change |
| `useDetachControl`, `UseDetachControlInput`, `DetachControl`<br>`ui/hooks/useDetachControl.ts` | React hook; source exports: useDetachControl, UseDetachControlInput, DetachControl. | Own lifecycle/state outside presentation | Composes React state/effects/callbacks and native/pure helpers | When the owning feature is mounted or dependencies change |
| `useDialog`, `DialogTone`, `UseDialogReturn`<br>`ui/hooks/useDialog.ts` | React hook; source exports: useDialog, DialogTone, UseDialogReturn. | Own lifecycle/state outside presentation | Composes React state/effects/callbacks and native/pure helpers | When the owning feature is mounted or dependencies change |
| `useEscToClose`<br>`ui/hooks/useEscToClose.ts` | React hook; source exports: useEscToClose. | Own lifecycle/state outside presentation | Composes React state/effects/callbacks and native/pure helpers | When the owning feature is mounted or dependencies change |
| `editorTabId`, `useScriptRuns`<br>`ui/hooks/useScriptRuns.ts` | React hook; source exports: editorTabId, useScriptRuns. | Own lifecycle/state outside presentation | Composes React state/effects/callbacks and native/pure helpers | When the owning feature is mounted or dependencies change |
| `useShellOptions`<br>`ui/hooks/useShellOptions.ts` | React hook; source exports: useShellOptions. | Own lifecycle/state outside presentation | Composes React state/effects/callbacks and native/pure helpers | When the owning feature is mounted or dependencies change |
| `useSplitRatios`<br>`ui/hooks/useSplitRatios.ts` | React hook; source exports: useSplitRatios. | Own lifecycle/state outside presentation | Composes React state/effects/callbacks and native/pure helpers | When the owning feature is mounted or dependencies change |
| `useTreeReveal`, `RevealRequest`<br>`ui/hooks/useTreeReveal.ts` | React hook; source exports: useTreeReveal, RevealRequest. | Own lifecycle/state outside presentation | Composes React state/effects/callbacks and native/pure helpers | When the owning feature is mounted or dependencies change |
| `useViewGroups`<br>`ui/hooks/useViewGroups.ts` | React hook; source exports: useViewGroups. | Own lifecycle/state outside presentation | Composes React state/effects/callbacks and native/pure helpers | When the owning feature is mounted or dependencies change |
| `useWorkspaceMutations`<br>`ui/hooks/useWorkspaceMutations.ts` | React hook; source exports: useWorkspaceMutations. | Own lifecycle/state outside presentation | Composes React state/effects/callbacks and native/pure helpers | When the owning feature is mounted or dependencies change |
| `useWorkspaceScan`, `FolderPageInfo`<br>`ui/hooks/useWorkspaceScan.ts` | React hook; source exports: useWorkspaceScan, FolderPageInfo. | Own lifecycle/state outside presentation | Composes React state/effects/callbacks and native/pure helpers | When the owning feature is mounted or dependencies change |
| `createCoalescer`, `Coalescer`<br>`ui/utils/coalesce.ts` | Renderer utility module; source exports: createCoalescer, Coalescer. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `ESC_CR`, `LF`, `DEFAULT_ENTER_MODES`, `resolveEnterModes`, `enterSequenceFor`, `EnterMode`, `EnterKeyEvent`, `EnterModes`<br>`ui/utils/enterKeys.ts` | Renderer utility module; source exports: ESC_CR, LF, DEFAULT_ENTER_MODES, resolveEnterModes, enterSequenceFor, EnterMode, EnterKeyEvent, EnterModes. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `fileKindMeta`, `FileKindMeta`<br>`ui/utils/fileKind.ts` | Renderer utility module; source exports: fileKindMeta, FileKindMeta. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `matchShortcut`<br>`ui/utils/keyboard.ts` | Renderer utility module; source exports: matchShortcut. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `clipboardActionFor`, `normalizePastePayload`, `ClipboardKeyEvent`, `ClipboardAction`<br>`ui/utils/paste.ts` | Renderer utility module; source exports: clipboardActionFor, normalizePastePayload, ClipboardKeyEvent, ClipboardAction. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `highlightLine`, `highlightLines`, `TokenType`, `Token`<br>`ui/utils/scriptHighlight.ts` | Renderer utility module; source exports: highlightLine, highlightLines, TokenType, Token. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `entryScript`, `entryOpenable`, `entryNode`, `buildWorkspaceTree`, `filterTreeByQuery`, `buildScriptTree`, `collectFilterDirPaths`, `WorkspaceTreeNode`<br>`ui/utils/scriptTree.ts` | Renderer utility module; source exports: entryScript, entryOpenable, entryNode, buildWorkspaceTree, filterTreeByQuery, buildScriptTree, collectFilterDirPaths, WorkspaceTreeNode. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `createSessionChannel`, `SessionChannel`<br>`ui/utils/sessionChannel.ts` | Renderer utility module; source exports: createSessionChannel, SessionChannel. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `FALLBACK_SHORTCUTS`, `resolveShortcuts`, `survivesTerminalFocus`, `matchesChromeShortcut`<br>`ui/utils/shortcuts.ts` | Renderer utility module; source exports: FALLBACK_SHORTCUTS, resolveShortcuts, survivesTerminalFocus, matchesChromeShortcut. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `createTerminalClipboard`, `TerminalClipboard`<br>`ui/utils/terminalClipboard.ts` | Renderer utility module; source exports: createTerminalClipboard, TerminalClipboard. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `safeHttpUrl`, `activateTerminalLink`, `registerPlainUrlLinks`<br>`ui/utils/terminalLinks.ts` | Renderer utility module; source exports: safeHttpUrl, activateTerminalLink, registerPlainUrlLinks. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `DEFAULT_MONO_STACK`, `createTerminalOptions`, `TerminalOptionsInput`<br>`ui/utils/terminalOptions.ts` | Renderer utility module; source exports: DEFAULT_MONO_STACK, createTerminalOptions, TerminalOptionsInput. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `attachTerminalStream`, `TerminalStreamOptions`, `TerminalStream`<br>`ui/utils/terminalStream.ts` | Renderer utility module; source exports: attachTerminalStream, TerminalStreamOptions, TerminalStream. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `DEFAULT_SANS_STACK`, `DEFAULT_MONO_STACK`, `isColorLight`, `themeCssVars`, `applyThemeVars`, `APP_COLOR_FIELDS`, `TERMINAL_COLOR_FIELDS`, `LIGHT_ONLY_TERMINAL_FIELD`, `readColorField`, `resolvedColorField`, `ThemeMode`, `ColorField`<br>`ui/utils/themeVars.ts` | Renderer utility module; source exports: DEFAULT_SANS_STACK, DEFAULT_MONO_STACK, isColorLight, themeCssVars, applyThemeVars, APP_COLOR_FIELDS, TERMINAL_COLOR_FIELDS, LIGHT_ONLY_TERMINAL_FIELD, readColorField, resolvedColorField, ThemeMode, ColorField. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `createWebglController`, `WebglController`<br>`ui/utils/webglController.ts` | Renderer utility module; source exports: createWebglController, WebglController. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `MAX_CONTEXTS`, `acquire`, `touch`, `release`, `heldCount`, `resetForTests`<br>`ui/utils/webglPool.ts` | Renderer utility module; source exports: MAX_CONTEXTS, acquire, touch, release, heldCount, resetForTests. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `workspaceConnections` module<br>`ui/utils/workspaceConnections.ts` | Renderer utility module; source exports: module-owned/private symbols. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `workspaceLocationLabel`<br>`ui/utils/workspaceDisplay.ts` | Renderer utility module; source exports: workspaceLocationLabel. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `discoverKinds`, `isHiddenEntry`, `isScriptEntry`, `isDefaultFilter`, `filterSummary`, `applyFilter`, `dirsHoldingConnections`, `SCRIPT_KINDS`, `DEFAULT_TREE_FILTER`, `TreeFilter`<br>`ui/utils/workspaceFilter.ts` | Renderer utility module; source exports: discoverKinds, isHiddenEntry, isScriptEntry, isDefaultFilter, filterSummary, applyFilter, dirsHoldingConnections, SCRIPT_KINDS, DEFAULT_TREE_FILTER, TreeFilter. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `buildWorkspaceForest`, `siblingPosition`, `workspacePinTarget`, `workspaceDropIndex`, `orderedWorkspaceRows`, `terminalWorkspaceSelection`, `WorkspaceHierarchyNode`, `WorkspaceSiblingPosition`, `OrderedWorkspaceRow`<br>`ui/utils/workspaceHierarchy.ts` | Renderer utility module; source exports: buildWorkspaceForest, siblingPosition, workspacePinTarget, workspaceDropIndex, orderedWorkspaceRows, terminalWorkspaceSelection, WorkspaceHierarchyNode, WorkspaceSiblingPosition, OrderedWorkspaceRow. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `WRITE_CHUNK_SIZE`, `chunkForWrite`<br>`ui/utils/writeChunks.ts` | Renderer utility module; source exports: WRITE_CHUNK_SIZE, chunkForWrite. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |
| `normalizeXtermTheme`<br>`ui/utils/xtermTheme.ts` | Renderer utility module; source exports: normalizeXtermTheme. | Keep deterministic calculations reusable/testable | Transforms explicit inputs or manages a small renderer resource abstraction | When components/hooks need the utility behavior |

## State and data

- This inventory stores documentation metadata only; renderer runtime state remains in the referenced modules.

## Errors and edge cases

- Type-only or private-only modules still appear by source path so they cannot become undocumented.
- A renamed/added source file fails the spec coverage test until this inventory is updated.

## Security and invariants

- Inventory presence does not grant native capability; renderer modules remain subject to Tauri/native security boundaries.

## Verification

- `scripts/__tests__/spec-docs.test.mjs` enumerates renderer source modules and requires every path in this inventory.

## Source map

- `ui/components`
- `ui/hooks`
- `ui/utils`
