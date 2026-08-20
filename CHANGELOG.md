# Changelog

## [Unreleased]

## [v1.1.6] — 2026-08-20

### Terminal & Sessions
- **Interactive link and path menu**: Modifier-clicking (Ctrl on Windows/Linux, Cmd on macOS) on detected URLs or filesystem paths opens an overlay menu to copy the link/path or open it in the default browser or OS handler. The legacy right-click action remains dedicated to copying selections and pasting.
- **Session Stop and Clear buttons**: Pane headers provide Stop (Ctrl+C) and Clear (Ctrl+L) icon buttons for active sessions, offering instant terminal clearing without polluting shell command history.
- **New terminal launcher menu**: Replaced the previous modal dialog with an inline dropdown menu accessible from the title bar, activity bar, and session tabs to quickly launch default shells, custom shells, workspace folders, or saved connections.
- **Session recovery overlay**: Displays a clear feedback overlay with a restart button when an attached terminal session disconnects or exits unexpectedly.
- **Session layout persistence**: Snapshots active tabs, view groups, and focused pane configuration to local storage so layout state automatically restores across application restarts. Local shells reopen in their last working directory, and agent sessions replay their resume command.
- **Cross-restart scrollback caching**: Stores raw PTY output in IndexedDB per session and replays it upon reconnecting, preserving terminal output history across restarts.
- **Agent-aware activity tracking**: Automatically parses OSC terminal titles to detect AI coding agents (Claude, Gemini, Aider, Cursor, etc.), differentiating autonomous agent activity and tool sub-processes from idle typing states.
- **Oscillating running indicator**: Pane headers display a smooth oscillating dot animation with ghost trails while a session is actively running, reverting to idle when work completes.
- **Responsive session controls**: Terminal control buttons dynamically measure available header and footer space, moving overflow items into a dropdown menu on narrow panes.
- **Per-terminal persistence policy menu**: Pane header and footer persistence controls open a popover menu allowing users to toggle lifetime policies between None, Window, Hybrid, and App.

### Windowing & Layouts
- **5-pane and 7-pane grid layouts**: Added Grid 5 (`Ctrl+5`) and Grid 7 (`Ctrl+7`) multi-pane layouts with orientation toggling between top-stacked and left-stacked arrangements.
- **Windows 11 window corner rounding**: Configured transparent, shadowless native window framing paired with dynamic CSS corner rounding (`useWindowRounding`) that automatically un-rounds when maximized.
- **Layout shortcut hints**: Added keyboard shortcut tooltips and quick orientation cycling across all grid modes (1 through 8 panes).

### UI Components & Primitives
- **Shared UI primitives**: Added standardized `Button`, `Keycap`, `KeycapCombo`, `Tooltip`, `SessionStatusIndicator`, and `SessionFooterBar` components with theme-adaptive styling.
- **Consolidated settings modal**: Unified settings into a single tabbed dialog (`SettingsModal`) covering General preferences, Appearance, Plugins, Updates, and Keyboard Shortcuts.
- **Workspace panel theme styling**: Styled workspace rows and secondary surfaces with dedicated theme background and sidebar tokens for clear visual hierarchy.
- **Themed global scrollbars**: Styled thin custom scrollbars matching active theme colors.

### Backend & Platform Integration
- **Safe OS path opening**: Introduced the `open_in_system` Tauri command with strict path validation that blocks URL schemes, control characters, and invalid input before invoking OS handlers.
- **Quick shell overrides**: Extended `open_quick_shell` to support renderer-supplied working directory and command overrides for seamless agent session restoration.
- **Public protocol helpers**: Exposed `cap_cwd` and `cap_command` helper functions from the protocol crate for consistent argument length-capping across launcher paths.
- **Process monitoring runtime dependency**: Moved `sysinfo` to a runtime dependency in the desktop app to ensure process-tree inspection works reliably in packaged release builds.

### Developer Experience & Tooling
- **Orphaned dev port recovery**: Added `free-dev-port.mjs` to automatically reclaim port 5173 from lingering Vite instances before starting dev servers.
- **Windows dev server stability**: Configured Vite file watching to ignore Cargo `target/` directories, preventing EBUSY file-lock crashes during build-script compilation.
- **Automated spec documentation tests**: Added validation test suites ensuring specification documents and source module inventories stay in sync with the codebase.
- **Expanded Rust test coverage**: Broadened unit and integration branch test coverage across the session daemon, client transport, and system pollers.

## [v0.1.5] — 2026-08-15

### Packaging & Release
- Resolved portable plugin host path resolution in packaged release builds.

## [v0.1.4] — 2026-08-14

### Workspace Management
- **Composite workspaces**: Supported workspaces with multiple local folder roots and nested workspace references.
- **Workspace import**: Added import support for VS Code and VSCodium `.code-workspace` and `.workspace` files while preserving local paths and names.
- **Inline folder renaming**: Enabled double-click inline renaming of workspace roots directly within the workspace tree panel.
- **Drag-and-drop hierarchy**: Added drag-and-drop support for nesting folders, moving items, and reordering sibling entries.
- **File and folder pinning**: Pinned important files and folders to the top of their parent section.
- **Filter search**: Added text filtering for selected-types and selected-files views without modifying saved selections.

### UI & Appearance
- Enhanced styling for background blur settings and waiting panes.
- Refined multi-resolution Windows app icons with a simplified front-terminal crop for crisp rendering at 16–48 px.

### Platform & Automation
- Configured GitHub Actions multiplatform release workflows for Windows portable/installer executables, Linux AppImages/debs, and macOS disk images.
- Added SSH remote URL verification to repository identity guards.

### Bug Fixes
- Validated workspace ID existence before checking folder parameters in workspace entry scans.
- Cleaned up unused variables and fixed test regressions across workspace panels and bridge contracts.

## [v0.1.3] — 2026-08-13

### Features
- Added background blur plugin support and configurable view groups for organizing terminal panes.
- Integrated repository agent skills for Claude Code, Copilot, and opencode.
- Added GitHub identity guard tooling for verifying local commit and push identities.

### Bug Fixes & Improvements
- Stabilized terminal and workspace user interface interactions.
- Established canonical repository code writing rules and size limits.

## [v0.1.2] — 2026-08-12

### Tooling & CI
- Added GitHub identity guard tooling for repository-local account locking.
- Fixed release workflow build arguments.
- Added repository code writing standards.

## [v0.1.1] — 2026-08-08

### Customization & Plugins
- Rebuilt Theme Remix around a live side-by-side dark and light mode preview.
- Migrated Always Awake plugin to a standalone contribution with its own stylesheet and Settings panel integration.

### Architecture & Testing
- Refactored Rust backend into modular workspace crates (`crates/app-core` and `crates/app-protocol`) and organized the frontend under `ui/`.
- Expanded test coverage across frontend components and plugin rejection paths (reaching 91.3% JS/TS branch coverage).
- Configured virtual display (Xvfb) for headless Linux CI test execution.

## [0.1.0] — 2026-07-31

### Core Features
- **Multi-window terminal hub**: Built offline multi-window local, SSH, and RDP terminal manager using Tauri 2 (Rust) and React.
- **PTY backend**: High-performance per-session PTY engine powered by `portable-pty` / ConPTY with xterm.js frontend rendering.
- **Detachable panes**: Moved terminal sessions into standalone OS windows with seamless re-attachment to the main window.
- **Workspace management**: Workspace panel with pinned folders, script navigation, and quick file preview.
- **Built-in editor & markdown viewer**: Syntax-highlighted file editor with `Ctrl+S` saving alongside Mermaid diagram markdown rendering.
- **Command palette**: Fuzzy search command palette (`Ctrl+K`) for rapid navigation and quick connections.
- **Theme customization**: Built-in dark and light themes with live remixing and JSON import/export.
- **Plugin architecture**: Node.js sidecar plugin host communicating via JSON-RPC 2.0 over stdio with bundled connection management plugins.

### Security & Privacy
- Zero-credential persistence architecture with no password fields, secret vaults, or credential-saving APIs.
- Suppressed all runtime logging in production release builds (`release_max_level_off`).
- Direct in-band interactive typing for SSH passwords.
- Strict Content Security Policy on renderer webviews.
- Single-instance gating routing secondary launches to the existing window.