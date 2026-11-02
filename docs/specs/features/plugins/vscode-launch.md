---
id: feature-plugin-vscode-launch
status: current
area: plugins
navigation: "Pane header launch dropdown; Launch drawer and multi-console tabs"
platforms:
  - desktop
  - tauri
tags:
  - plugins
  - vscode
  - launch
  - debugging
  - runner
related:
  - feature-plugin-lifecycle-runtime
  - feature-terminal-lifecycle
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Feature Plugin VS Code Launch

## Description

The bundled VS Code Launch plugin parses `.vscode/launch.json` and `.vscode/tasks.json` in the active workspace to run and debug target configurations directly from OmniTerm terminal pane headers, with integrated multi-console output drawers and background watcher support.

## What

A launch trigger button (`Launch (N)`) in the terminal pane header displays the count of available launch configurations and compounds. Clicking opens a dropdown menu to run or debug configurations. Output renders in a collapsible, multi-tab console drawer docked below the terminal pane, supporting concurrent target executions, background watcher unblocking, ANSI styling, search filtering, link navigation, and process tree lifecycle control.

## Why

Developers working inside terminal panes frequently need to run tests, APIs, debug hosts, or watchers defined in repository `.vscode/launch.json` without switching away to an external editor or managing multiple ad-hoc terminal processes manually. Integrating `.vscode/launch.json` execution natively keeps console output organized per target while preserving full shell and TUI workflows in the main terminal.

## How

- **Sidecar Discovery & Execution** (`plugins/vscode-launch/src`):
  - `scanner.ts` reads and parses `.vscode/launch.json` and `.vscode/tasks.json`, expanding variables (`${workspaceFolder}`, `${fileBasename}`, `${env:...}`).
  - `adapters.ts`, `dotnetAdapter.ts`, and `browserAndExtensionAdapters.ts` synthesize command lines for Node.js, .NET Core (`netcoredbg` DAP adapter), Python (`debugpy`), Go (`delve`), Rust (`cargo`), browsers (`chrome`, `msedge`, `firefox`), and VS Code / VSCodium Extension Host (`extensionHost`).
  - `tasks.ts` and `processIO.ts` resolve `preLaunchTask` dependencies. Tasks marked with `isBackground: true` or problem matchers (`$tsc-watch`) unblock execution immediately when readiness regex patterns match (e.g. `watching for file changes`), keeping the background compiler alive as `backgroundChild`.
  - `runner.ts` spawns processes with appropriate GUI flags (`windowsHide: false` for browsers and extension hosts), streams stdout/stderr, and terminates the complete process tree on stop.
- **Renderer Host & Console Drawer** (`plugins/vscode-launch/app`):
  - `PaneLaunchControl.tsx` attaches to the pane header toolbar, rendering the launch trigger and menu.
  - `LaunchDrawer.tsx` docks below the terminal with resizable height and collapse toggle.
  - `LaunchTabsStrip.tsx` hosts tabs for concurrent targets with status indicators, process controls, and accessible tooltips (`Stop & Close Console`).
  - `LaunchConsole.tsx` displays virtualized streamed logs with ANSI formatting, regex search, external link opening, and cursor copy feedback.
  - `launchStore.ts` tracks active configurations, output buffers, running states, and clean process termination.

## When

The plugin runs when enabled in OmniTerm's Plugin Manager and a workspace directory contains a valid `.vscode/launch.json` file. The drawer opens automatically on launch trigger or manually via pane controls.

## Behavior

- The pane header displays `Launch (N)` where N is the number of valid configurations discovered. If no `.vscode/launch.json` is present or N is 0, the trigger is hidden.
- Selecting a configuration resolves `preLaunchTask` first. If the pre-task is a background watcher (`isBackground: true` or `$tsc-watch`), it begins streaming to the console; once compilation readiness is detected, the main target launches without waiting for the pre-task process to exit.
- Both the main process and any background pre-task process are tracked. Stopping a console or closing a running console tab terminates both child process trees cleanly.
- Browser (`chrome`, `msedge`) and extension host (`extensionHost`) targets launch visibly with system GUI windows using detected or configured runtime binaries (VS Code, VSCodium, Chrome, Edge).
- Clicking links in console output verifies URL security before delegating to the native system browser via `omnitermAPI.app.openUrl`.
- Console tabs feature accessible `<Tooltip>` popups and context menus offering `Stop & Close Console` when running and `Close Console` when exited.

## Functionalities

- `.vscode/launch.json` and `.vscode/tasks.json` parsing and variable substitution.
- Multi-language debug adapter synthesis (.NET, Node, Python, Go, Rust, Web, VS Code Extensions).
- Background watcher pre-launch task readiness pattern matching.
- Multi-target concurrent console management with docking drawer.
- Process tree termination via `tree-kill` / Win32 taskkill.
- Output search, ANSI formatting, auto-scroll lock, and external URL dispatch.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `scanner.ts` / `scanWorkspace` | Scan and parse launch and task configurations. | Extract executable definitions and compound targets. | Reads `.vscode/launch.json` and `.vscode/tasks.json` using JSON5/JSON parser and resolves variables. | Workspace load or reload. |
| `adapters.ts` / `resolveAdapter` | Synthesize launch command and arguments. | Translate launch configuration into executable CLI commands. | Maps configuration type to runtime adapter handler. | Target launch initiation. |
| `dotnetAdapter.ts` / `resolveDotnetLaunch` | Synthesize .NET and netcoredbg launch configuration. | Support C# / F# / .NET debugging via netcoredbg DAP. | Locates `netcoredbg.exe` or `dotnet exec` with target assembly DLL. | Launching `coreclr` or `dotnet` targets. |
| `browserAndExtensionAdapters.ts` / `resolveBrowserLaunch` | Synthesize browser and VS Code extension host launches. | Support web debugging and extension host development. | Resolves browser binaries, extension dev paths, and sets visible window flags. | Launching `chrome`, `msedge`, or `extensionHost` targets. |
| `tasks.ts` / `resolveTask` | Resolve pre-launch and post-debug tasks. | Ensure build steps and watchers run in sequence. | Matches `preLaunchTask` name against tasks inventory and extracts background watch patterns. | Prior to launching target. |
| `processIO.ts` / `executePreTask` | Run pre-launch tasks with background watcher unblocking. | Prevent long-running watcher tasks from stalling launches. | Monitors stdout/stderr for watcher readiness regex patterns and unblocks asynchronously. | Pre-task execution. |
| `runner.ts` / `LaunchRunner` | Supervise child processes and output streaming. | Manage lifecycle, stdout/stderr streams, and process trees. | Spawns child and background processes, pushes chunks to RPC subscribers, and handles termination. | During active target execution. |
| `PaneLaunchControl.tsx` | Header trigger and target selection dropdown. | Provide accessible entry point in terminal pane header. | Renders button with configuration count badge and target menu. | Pane header render. |
| `LaunchDrawer.tsx` | Docked drawer hosting console views. | Display output logs without obscuring main terminal session. | Renders collapsible drawer with tab bar and active console. | Target launched or drawer opened. |
| `LaunchTabsStrip.tsx` | Multi-target tab bar with stop/close controls. | Allow switching and controlling multiple concurrent consoles. | Renders tab chips with running spinners, close buttons, and tooltips. | Drawer rendered with consoles. |
| `LaunchTabMenu.tsx` | Context menu for console tabs. | Provide convenient restart, stop, and close actions. | Renders context menu on right-click of tab. | Tab right-clicked. |
| `LaunchConsole.tsx` | Streamed console log viewer with search. | Render colored output with search, scroll lock, and copy feedback. | Virtualized log rows with ANSI parser, search highlighter, and link click handlers. | Active console view. |
| `launchStore.ts` | State management store for launch runner. | Centralize active consoles, logs, process status, and actions. | Zustand store connecting RPC client to UI components with process kill on close. | Throughout plugin lifetime. |

## State and data

- `configurations`: List of parsed `LaunchConfiguration` and compound definitions.
- `activeConsoles`: Map of target IDs to running status, stdout/stderr buffer, and exit codes.
- `activeTabId`: ID of the currently focused console in the drawer.
- `isDrawerOpen`: Visibility state of the launch drawer.
- `drawerHeight`: Persisted or resized pixel height of the drawer.

## Errors and edge cases

- Missing or malformed `.vscode/launch.json`: Safely reports error notice and disables launch trigger without crashing.
- Missing debugger executable (e.g. `netcoredbg` or `delve` not installed): Logs actionable error message into console stream with installation guidance.
- Non-terminating background watcher: Correctly detects compilation readiness without waiting for process exit; terminates cleanly when console tab is closed.
- Broken output links: Validated against `is_allowed_plugin_url` and safe HTTP URL schemes before opening.

## Security and invariants

- Launch commands run locally with the permissions of the current user.
- All command line arguments are escaped to avoid shell injection vulnerabilities.
- URLs clicked in console logs validate scheme (`http://` or `https://` only) and reject credentials or shell characters before delegating to `omnitermAPI.app.openUrl`.
- Process termination cleanly sweeps entire process tree (`tree-kill` / Win32 taskkill) to avoid orphaned background daemons.

## Verification

- `plugins/vscode-launch/__tests__/scanner.test.ts`: verifies `.vscode/launch.json` parsing, comments, and variable substitution.
- `plugins/vscode-launch/__tests__/adapters.test.ts`: verifies CLI synthesis across Node, .NET, Python, Go, and Rust.
- `plugins/vscode-launch/__tests__/browserAndExtensionAdapters.test.ts`: verifies Chrome, Edge, and extensionHost argument construction.
- `plugins/vscode-launch/__tests__/tasks.test.ts`: verifies background watcher detection and pre-task ordering.
- `plugins/vscode-launch/app/__tests__/LaunchTabsStrip.test.tsx`: verifies tab switching, tooltips, and stop/close behavior.
- `plugins/vscode-launch/app/__tests__/LaunchTabMenu.test.tsx`: verifies context menu actions.
- `scripts/__tests__/spec-docs.test.mjs`: validates spec structure, frontmatter, and component table completeness.

## Source map

- `plugins/vscode-launch/src/index.ts`
- `plugins/vscode-launch/src/types.ts`
- `plugins/vscode-launch/src/scanner.ts`
- `plugins/vscode-launch/src/runner.ts`
- `plugins/vscode-launch/src/adapters.ts`
- `plugins/vscode-launch/src/dotnetAdapter.ts`
- `plugins/vscode-launch/src/browserAndExtensionAdapters.ts`
- `plugins/vscode-launch/src/tasks.ts`
- `plugins/vscode-launch/src/processIO.ts`
- `plugins/vscode-launch/app/PaneLaunchControl.tsx`
- `plugins/vscode-launch/app/LaunchDrawer.tsx`
- `plugins/vscode-launch/app/LaunchTabsStrip.tsx`
- `plugins/vscode-launch/app/LaunchTabMenu.tsx`
- `plugins/vscode-launch/app/LaunchConsole.tsx`
- `plugins/vscode-launch/app/launchStore.ts`
