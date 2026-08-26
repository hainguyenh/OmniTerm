# Changelog

## [v0.1.8] — 2026-08-26

### Added
- feat(ui): pasted-image history viewer with pager (@the-long-ride)
- feat(ui): pane-header button opens pasted-image viewer (@the-long-ride)
- feat(ui): full-res pasted-image viewer modal (@the-long-ride)
- feat(clipboard): report saved image bytes to pane viewers (@the-long-ride)
- feat(ui): per-session pasted-image store (@the-long-ride)
- feat(plugin): always-awake status becomes switch (@the-long-ride)
- feat(ui): rename clickhouse theme to compact (@the-long-ride)
- feat(ui): new-terminal menu enter opens folder (@the-long-ride)

### Fixed
- fix(ui): keep new-terminal menu cursor visible (@the-long-ride)
- fix(ui): new-terminal menu arrows survive typing a search (@the-long-ride)
- fix(ui): latch agent title for image paste (@the-long-ride)
- fix(ui): menu arrows die after typing a search (@the-long-ride)
- fix(ui): theme menu fits short window viewports (@the-long-ride)
- fix(ui): resend pty dims when session ready (@the-long-ride)
- fix(terminal): drop trailing line from copy-last-output (@the-long-ride)
- fix(terminal): copy-last-output, pane stop, image paste per agent (@the-long-ride)

### Changed
- docs(specs): add pasted-image viewer spec, sync inventories (@the-long-ride)

### Refactored
- refactor(ui): extract ctrl+wheel font resizer from TerminalView (@the-long-ride)

### Tests
- test(ui): pin menu arrow-key event bubbling (@the-long-ride)


## [v0.1.7] — 2026-08-24

### Added
- feat: session freeze lifecycle, native auto-updater, and terminal UX batch (@Thế Long)
- feat: focused-slot reattach pulse, shortcuts bridge, API surface (@the-long-ride)
- feat: alt+click cursor positioning + pane-header copy menu (@the-long-ride)
- feat: default workspace choice for new terminals (@the-long-ride)
- feat: versioned settings export/import across four stores (@the-long-ride)
- feat: native updater release infra + settings UI hooks (@the-long-ride)
- feat: paste clipboard images into terminal agents (@the-long-ride)
- feat: folder aliases and live cwd in pane headers (@the-long-ride)
- feat: session freeze + close-with-app default (@the-long-ride)

### Fixed
- fix: align unix suspend API with ProcIndex snapshot (@the-long-ride)
- fix: detach window UX polish + stop button live flag + force-kill timer (@the-long-ride)
- fix: always-awake plugin bounded retry + jiggle improvements (@the-long-ride)
- fix: exclude trailing shell prompt from copy-last-output (terminalCopyExtract) (@the-long-ride)
- fix: gate updater plugin on OMNITERM_UPDATER_PUBKEY env var (lib.rs + update_manager) (@the-long-ride)
- fix(ui): promote detach/fullscreen out of the overflow menu (@the-long-ride)
- fix(ui): clip split panes instead of horizontal scroll (@the-long-ride)

### Changed
- docs: spec + changelog updates for shipped features (@the-long-ride)
- perf: cut redundant daemon I/O, scans and render churn (@the-long-ride)
- docs: sync freeze, default policy and pane clip specs (@the-long-ride)

### Refactored
- refactor: workspace, pty-resolve, probe, and util cleanup (@the-long-ride)
- refactor: window control, themes dir-swap retry, rdp cleanup (@the-long-ride)
- refactor: plugin host rpc + management cleanup (@the-long-ride)

### Tests
- test: cover manager state-dir failure, exclude plugin Wry instances (@the-long-ride)
- test: cover transfer/manifest error paths, exclude updater arms (@the-long-ride)
- test: always-awake poller + native entry updates (@the-long-ride)
- test: ipc + command integration coverage refresh (@the-long-ride)
- test: stop-button escalation regression coverage (@the-long-ride)
- test: settings transfer + backup section UI coverage (@the-long-ride)
- test: split oversized Rust test modules by responsibility (@the-long-ride)

### Other
- pull latest ME (@the-long-ride)


## [Unreleased]

### Terminal & Sessions
- **Stop escalation with live-session gating**: The Stop button no longer depends on the activity probe, which misread idle on WSL and fast commands — a connected session keeps Stop pressable. Pressing Stop sends SIGINT first; if the process survives a short escalation delay, the control re-arms into a Force-kill action that tears down the daemon session.
- **Freeze while closed**: New per-session persistence policy. When OmniTerm closes, the session's whole process tree is suspended (nothing runs: no CPU, no output, no file edits); reopening resumes it exactly where it stopped, with buffered output replayed first. Suspension uses `NtSuspendProcess` on Windows and `SIGSTOP` on Unix; a boot sweep reaps frozen orphans after a daemon crash.
- **Close with OmniTerm is the default lifetime**: Every new terminal — plain shells and AI agent sessions alike — now terminates when the app closes. Keep running, Freeze while closed, and Recover after reboot remain one click away in the persistence menu, and agent resume commands (`claude --continue`, etc.) are still remembered for recovery.
- **Safer session resume bookkeeping**: Frozen-session manifests are rewritten immediately on resume, and freeze/resume never signal a recycled process id.

### Workspace Management
- **Default workspace for new terminals**: A new General setting picks where terminals land when their launch site does not name a workspace — last used (previous behavior), system home, any workspace root, or a pinned folder inside one. Saved choices that no longer resolve fall through to the next candidate instead of failing the launch.

### Settings
- **Whole-settings export/import**: Settings can be exported as a single timestamped envelope covering preferences, shortcuts, and custom themes, then imported on another machine with either a merge (existing values win) or replace strategy. Everything is validated before any write, so a bad section aborts cleanly instead of leaving a half-applied state.

### Windowing & Layouts
- **App fullscreen (F11)**: F11 now toggles true OS-level fullscreen together with a chrome-hidden mode — title bar, activity bar, side panel, and tab strip disappear so every terminal pane fills the screen while the status bar stays visible. Rebindable in settings, Escape exits, and window corner rounding adapts automatically.
- **No horizontal scrollbar in split layouts**: Dragging a divider no longer scrolls the terminal desktop. Panes are pure percentage geometry that clips inside its frame — oversized terminals stay contained instead of pushing the container wide.

## [v0.1.6] — 2026-08-20

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