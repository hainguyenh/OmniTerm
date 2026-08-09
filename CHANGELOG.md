# Changelog

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