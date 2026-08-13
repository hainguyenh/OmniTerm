# Changelog

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

### Fixed
- Launch debug output in `generate-app-assets.mjs` is silenced during normal dev/launch unless icons or assets actually change.
- Workspace tree panel simplified by removing manual up/down arrow buttons in favor of direct drag-and-drop reordering.
- Workspace IPC now always serializes `pins`, and the renderer normalizes older payloads that omit empty pins, preventing workspace-tree `.some()` crashes.
- The Tauri workspace module no longer re-exports the test-only `workspaces_file` helper in normal builds, removing its unused-import warning.
- Windows 16–48 px app icons now use a simplified front-terminal composition so taskbar/window icon slots remain crisp instead of downsampling the full three-window glow artwork.
- Composite workspace Rust modules now import the protocol library by its declared crate name `app_protocol`, fixing the `omniterm_protocol` unresolved-crate build error.

### Changed
- Existing single-path workspace records auto-migrate to one-folder composite workspaces while preserving ID, name, and list order.
- Workspace filesystem operations now use folder-scoped logical paths instead of treating the workspace container as one merged filesystem root.
- Multi-folder workspaces require choosing a concrete folder for terminal and workspace-connection actions.
- `docs/specs/` is decomposed into architecture, feature, component, contract, and design sub-folders; leaf specs document description, behavior, functionality, What/Why/How/When, state, errors, security, verification, and source ownership.

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