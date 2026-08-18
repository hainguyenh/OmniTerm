# Changelog

## [Unreleased]

### Added
- feat(scripts): add `scripts/free-dev-port.mjs` to reclaim dev port 5173 from an orphaned vite before it binds (@the-long-ride)
- feat(specs): add `docs/specs/architecture/dev-server-stability.md` leaf spec for the Windows-only `tauri dev` lifecycle invariants (@the-long-ride)
- feat(terminal): right-click link/path overlay menu (Copy Link/Open Link, Copy Path/Open in OS) — `terminalLinks.ts` detects URL or filesystem path at the click coordinate and routes through `createTerminalContextMenu`; `Open in OS` is hidden for non-LOCAL panes (@the-long-ride)
- feat(tauri): `open_in_system` command backed by `validate_path_for_open` — refuses URLs (incl. authority-less schemes like `mailto:`), control chars, and empty input; trims surrounding whitespace before opening with `opener::open` (@the-long-ride)
- feat(specs): add `docs/specs/features/sessions/terminal-status-link-menu.md` leaf spec for the running indicator signal, oscillating dot, and right-click link/path menu (@the-long-ride)

### Fixed
- fix(tauri-dev): prevent EBUSY crash when cargo links build-script `.exe` files in `target/` by ignoring the bare `target` directory in vite's watcher so chokidar installs no `fs.watch()` on it (matcher `isCargoTarget` with regex `(^|[/\\])target([/\\]|$)`) (@the-long-ride)
- fix(dev): reclaim port 5173 from an orphaned (crashed/killed) vite before the next `pnpm dev`/`pnpm tauri dev` start hits the hard-coded `strictPort` rejection (@the-long-ride)
- fix(tests): repair 6 committed-broken fixtures in `ui/__tests__/terminalStream.test.ts` by adding the required `generation: number` field to `ResumeSnapshot` resume mocks so `pnpm test` (and a cold `pnpm typecheck`) no longer fail TS2345 on those snapshots (@the-long-ride)
- fix(cargo): move `sysinfo` to runtime `[dependencies]` in `src-tauri/Cargo.toml` so packaged Tauri builds link `sysinfo` for `always_awake` (which uses `sysinfo::System` at runtime to inspect the live process tree); previously dev-only, release builds would fail to link (@the-long-ride)

### Changed
- build(scripts): preface `dev` and `dev:frontend` with `node scripts/free-dev-port.mjs` (`pnpm tauri dev` inherits it transitively via `beforeDevCommand: "pnpm dev:frontend"`) so a stale port holder is reclaimed before vite binds (@the-long-ride)
- build(gitignore): also ignore `/vite.config.d.ts` (the declaration file `tsc -b` emits alongside the already-ignored `/vite.config.js`) so `pnpm typecheck` does not leave an untracked build-trash file in the working tree (@the-long-ride)
- refactor(session): tighten explicit-disconnect guard comment and collapse `AttachedSession` struct literal in `session-core/manager.rs` (@the-long-ride)
- refactor(terminal): drive pane busy/idle from the backend activity probe only (`onLocalActivity`); drop the bytes-driven activity debounce in `terminalStream.ts` so long output no longer strobes the running indicator (@the-long-ride)
- feat(terminal): pane header renders an oscillating running dot plus two ghost-trail dots (`runningStyle='oscillate'`); picker dropdown and tab indicators keep the legacy `ping` style (@the-long-ride)
- refactor(terminal): extract `createTerminalContextMenu` + `TerminalViewLinkMenuHost` from `TerminalView.tsx` to bring it under the 500-line source limit and unit-test the menu dispatch in isolation (@the-long-ride)
- build(rust): unblock `cargo clippy --workspace -- -D warnings` — `session-core/src/manifest.rs` redundant closure, `session-core/src/manager.rs` needless `Ok(... ?)` wrap, `src-tauri/src/pty.rs` scoped `#[allow(clippy::too_many_arguments)]` for the `start_local_session` Tauri command (renderer args are positionally injected), `src-tauri/src/pty_tests.rs` unused `tauri::Manager` import (@the-long-ride)
- docs(specs): register new UI modules (`TerminalLinkMenu`, `TerminalViewLinkMenuHost`, `createTerminalContextMenu`) and updated `terminalLinks` exports, plus the Rust `open_in_system` public function, in `docs/specs/components/{frontend,rust}/source-inventory.md` (@the-long-ride)

## [v0.1.4] — 2026-08-14

### Added
- feat: enhance workspace tree UI, appearance customization, and OS actions (@hainguyenh)
- feat(gha): add manual-build workflows for custom build on branch or commit (@the-long-ride)
- feat(workspace): support VS Code workspace import, drag-and-drop reordering, and inline rename (@Hai Nguyen)
- feat: improve UI for blur and waiting pane, fix multiple bugs (@hainguyenh)
- feat(workspace): update UI workspace tree, drag-drop reordering, and double-click rename (@the-long-ride)
- feat(workspace): add composite workspace Rust domain models and Tauri IPC (@the-long-ride)
- feat(identity): support SSH remote URLs in identity core guard (@the-long-ride)

### Fixed
- fix: revert WaitingPane UI to inline controls (@Hai Nguyen)
- fix: revert WaitingPane UI to inline controls (@hainguyenh)
- fix(gha): coverage (@the-long-ride)
- fix(rust): validate workspace ID existence before checking folder parameter in scan_workspace_entries (@the-long-ride)
- fix(rust): remove unused remote_path variable in ipc_workspace_tests.rs (@the-long-ride)
- fix(tests): auto-expand workspace root folders and fix MainLayout workspace label selector (@the-long-ride)
- fix(tests): remove unused variable in WorkspaceContainerList.test.tsx (@the-long-ride)
- fix(tests): resolve Vitest workspace panel and bridge contract suite regressions (@the-long-ride)
- fix(icon): refine Windows taskbar and window icon composition (@the-long-ride)

### Changed
- build: include contributor and PR message in changelog (@hainguyenh)
- chore: trigger PR checks (@hainguyenh)
- chore: release v0.1.4 - workspace tree UI, custom appearance, and OS actions (@Hai Nguyen)
- docs(specs): add property-tagged software specification docs and inventories (@the-long-ride)

### CI
- ci(release): enhance GHA multiplatform release workflow and packaging (@the-long-ride)

### Other
- enh(GHA): show link to download directly the built package with short SHA commit id. (@the-long-ride)
- fix(gha) enhance manual build workflow (@the-long-ride)
- merge: sync master into 0.1.4 (@hainguyenh)
- update markdown explorer (@the-long-ride)


## [Unreleased]

### Added
- Double-click workspace alias rename: inline text editing directly from the workspace tree panel backed by `rename_workspace` Rust Tauri IPC.
- Multiplatform GitHub Actions release workflow for Windows portable `.exe`, Windows installer `.exe`, Linux `.AppImage`, Linux `.deb`, macOS `.dmg`, and standalone plugin zips with clean emoji-free tabular release notes.
- Composite workspaces can contain multiple local folder roots and nested workspace references.
- Import VS Code/VSCodium `.code-workspace` and `.workspace` files while importing only workspace/folder names and local paths.
- Workspace files and folders can be pinned to the top of their sibling section.
- Workspace hierarchy supports persisted drag/drop nesting, sibling reordering, and keyboard move controls.
- Selected-types and selected-files filters now include search fields that do not alter saved selections.
- `docs/specs/` now routes the current product surface through property-tagged software specifications.
- Detailed spec source inventories trace every top-level renderer module and every public Rust/Tauri function.
- Session persistence: the active tab layout, view-group configuration, and focused pane are snapshotted to `localStorage` and restored across restarts; LOCAL shell sessions reopen in the same working directory, agent sessions also replay their resume command.
- Cross-restart scrollback: raw PTY output is cached in IndexedDB per session and repainted verbatim on reconnect so the terminal history survives app restarts.
- Output-activity tracking in `terminalStream`: an `onActivity(busy)` callback debounces PTY data bursts and integrates local-process busy/idle signals from the backend; consumers no longer need to poll status.
- Agent-aware pane header and session tabs: OSC terminal titles are parsed to detect Claude, Gemini, Aider, Cursor, and similar agents; the pane header shows the agent name, folder context, and a Bot icon; the session tab shows an animated marching-ants border while the agent is active.
- New shared UI primitives: `Button`, `Keycap`, `KeycapCombo`, `Tooltip` (viewport-aware placement with keyboard shortcut display), `SessionStatusIndicator` (color-coded dot + marching-ants SVG ring), and `SessionFooterBar`.
- `SettingsModal` component consolidates the five settings tabs (General, Plugins, Appearance, Updates, About/Shortcuts) extracted from `MainLayoutOverlays`.
- `agentRegistry`: maps agent display names to CLI resume recipes (command + resume args).
- `agentTitle`: parses OSC terminal titles to detect agents and extract folder context.
- `sessionStore` / `scrollbackStore`: versioned localStorage snapshot and IndexedDB scrollback cache with schema validation and automatic discard of stale data.
- `shortcutFormatting`: formats key combinations for Keycap and Tooltip display.
- `open_quick_shell` Tauri command now accepts optional renderer-supplied `cwd` and `command` overrides, validated the same way launcher argv is (capped lengths, real directory check); used by session-restore to reopen agent tabs with the correct working directory and resume command.
- `cap_cwd` and `cap_command` public helpers exposed from `app-protocol` for consistent length-capping across the launcher and renderer-override code paths.
- Layout-mode buttons now show Tooltip labels with `Ctrl+N` shortcut hints; split-2 toggles columns/rows, split-3 cycles left/right/top on repeated click.
- Activity-bar and title-bar buttons wrapped in `Tooltip` with keyboard shortcuts (`Ctrl+B`, `Ctrl+,`).

### Fixed
- Launch debug output in `generate-app-assets.mjs` is silenced during normal dev/launch unless icons or assets actually change.
- Workspace tree panel simplified by removing manual up/down arrow buttons in favor of direct drag-and-drop reordering.
- Workspace IPC now always serializes `pins`, and the renderer normalizes older payloads that omit empty pins, preventing workspace-tree `.some()` crashes.
- The Tauri workspace module no longer re-exports the test-only `workspaces_file` helper in normal builds, removing its unused-import warning.
- Windows 16–48 px app icons now use a simplified front-terminal composition so taskbar/window icon slots remain crisp instead of downsampling the full three-window glow artwork.
- Composite workspace Rust modules now import the protocol library by its declared crate name `app_protocol`, fixing the `omniterm_protocol` unresolved-crate build error.
- Attach/detach freeze eliminated: restored scrollback is now written with colouring off and chunked, avoiding the synchronous regex pass over large buffers.
- Activity and error paths now clear the output-activity debounce timer before marking the stream idle, preventing stale busy indicators.

### Changed
- Existing single-path workspace records auto-migrate to one-folder composite workspaces while preserving ID, name, and list order.
- Workspace filesystem operations now use folder-scoped logical paths instead of treating the workspace container as one merged filesystem root.
- Multi-folder workspaces require choosing a concrete folder for terminal and workspace-connection actions.
- `docs/specs/` is decomposed into architecture, feature, component, contract, and design sub-folders; leaf specs document description, behavior, functionality, What/Why/How/When, state, errors, security, verification, and source ownership.
- View groups now default to label `Desktop N` instead of `View N`.
- `LayoutMode` type is now derived from `LAYOUT_MODES as const` array, enabling runtime iteration over valid values without duplication.
- Global webkit scrollbars are styled thin with theme colors; `no-scrollbar` utility also zeroes width/height for complete suppression.
- Vite `optimizeDeps.entries` set to `index.html` to avoid cold-start pre-bundle churn.

## [v0.1.3] — 2026-08-13

### Added
- feat: improve UI for blur and waiting pane, fix multiple bugs
- feat(ui): add blur plugin and view groups
- feat(tooling): expose agent skills to Claude Code, Copilot, and opencode
- feat(tooling): guard GitHub identity

### Fixed
- fix(GHA): remove redundant `--` in build command
- fix: stabilize terminal and workspace UI

### Changed
- chore: sync Cargo.lock with the v0.1.2 crate versions
- docs: add code writing rules

### Other
- Merge pull request #24 from hainguyenh/fix/fix-release-workflow
- Merge pull request #23 from hainguyenh/fix/release-page-skip-propagation
- Merge pull request #22 from hainguyenh/fix/release-page-skip-propagation
- Merge branch 'master' into fix/release-page-skip-propagation
- Merge pull request #21 from hainguyenh/feat/enhance-bump-version-stuff

## [v0.1.2] — 2026-08-12

### Added
- feat(tooling): guard GitHub identity

### Fixed
- fix(GHA): remove redundant `--` in build command
- fix: stabilize terminal and workspace UI

### Changed
- docs: add code writing rules

### Other
- Merge pull request #24 from hainguyenh/fix/fix-release-workflow
- Merge pull request #23 from hainguyenh/fix/release-page-skip-propagation
- Merge pull request #22 from hainguyenh/fix/release-page-skip-propagation
- Merge branch 'master' into fix/release-page-skip-propagation
- Merge pull request #21 from hainguyenh/feat/enhance-bump-version-stuff


## [v0.1.1] — 2026-08-08

### Added
- feat: rebuild Theme Remix around a live two-mode preview (dark + light side-by-side)

### Fixed
- fix: make Always Awake an actual plugin contribution instead of a built-in
- fix: give the Always Awake modal its stylesheet back and pin its icon to Settings
- fix: silence two dead_code warnings in the protocol crate's test fixtures
- fix: unflake a connections test and make the theme-root scan testable
- The security-gate symlink test no longer fails on Windows without Developer Mode; it skips with a named reason there and still runs in full on Linux CI.

### Refactored
- refactor: split Rust into workspace crates (crates/app-core, crates/app-protocol) and rename frontend to ui/
- refactor: migrate the light-mode and Always Awake work onto the new layout

### Tests
- test: cover the frontend and plugin rejection paths (137 new tests, JS/TS branch coverage 88.4% → 91.3%)

### CI
- ci: boot the Rust coverage smoke run under a virtual display (Xvfb)

### Plugins
- plugin(ME): pull latest markdown-explorer

## [0.1.0] — 2026-07-31

### Added
- Multi-window terminal hub: local, SSH, and RDP sessions via Tauri 2 (Rust) + React
- Per-session PTY backend (`portable-pty` / ConPTY) with xterm.js rendering
- Detachable panes: pop a terminal into its own OS window, re-attach later
- Workspace panel with pinned folders, filterable scripts, and file preview
- File viewer/editor with syntax highlighting; editable `.ps1`/`.sh`/`.bat`/`.cmd` with `Ctrl+S`
- Markdown preview with Mermaid diagram rendering (via markdown-explorer submodule)
- Command palette (`Ctrl+K`) with fuzzy-search and quick-connect
- Dark/light theme customization and JSON import/export
- Plugin system: Node.js 24 sidecar, JSON-RPC 2.0 over stdio
- Plugin providers: ConnectionProvider, WorkspaceProvider, AuthProvider
- Bundled plugins: `full-connection-manager` and `native-batch-connections`
- CI test gate (`test-gate.yml`): parallel lint/test/coverage/security + tag-triggered release
- Security audit script (`check-no-password-persistence.mjs`) verifying zero-credential policy

### Security
- No credential storage anywhere: no password field, vault, save API, or credential RPC
- Legacy password scrubber removed (`credential_vault.rs` deleted)
- `release_max_level_off` in Rust — zero log output in release builds
- Lockdown for blocked SSH creds: `BatchMode=no`, credentials typed in-band via PTY
- Imports validated through single choke point (`tree_validate.rs`)
- Webview CSP: default-src 'self' + named schemes only
- Single instance gating: double launch routes to first window

### Changed
- README.md: purpose, plugins, and integration only; engine/stack/shortcuts moved to GUIDELINE.md
- Connection form: password field and credential metadata removed
- Plugin contract API: removed mostly unused `credentials` permission
- CI: pnpm workspace flag for coverage, Ubuntu system deps for Rust builds

### Fixed
- `pnpm add -w -D @vitest/coverage-v8` — was missing `-w` flag for workspace root
- Ubuntu Runner CI: added `libwebkit2gtk-4.1-dev` and related system libs for Tauri Rust builds
- Submodule URL corrected to HTTPS in `.gitmodules`; local clone kept as fast disk-based remote

### Known Issues
- No macOS/Linux release packaging yet (Windows NSIS only)
- Rust coverage job (`cargo llvm-cov`) may require additional system library handling on CI
- Plugins are unsandboxed; install only trusted packages