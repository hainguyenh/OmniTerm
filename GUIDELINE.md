# Installation & Development Guide

This document covers prerequisites, environment setup, and the full development
workflow for OmniTerm. For feature descriptions and architecture, see [README.md](README.md).

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | >= 24 | Active LTS, ESModules + workspace support |
| pnpm | 11.9.0 | Managed via [Corepack](https://nodejs.org/api/corepack.html) |
| Rust | 1.77.2+ | Via [rustup](https://rustup.rs); `msvc` toolchain on Windows |
| Git | 2.30+ | Required for submodules |

Enable Corepack:

```bash
corepack enable
```

Install Rust (if not already present):

```bash
rustup update stable
rustup target add x86_64-pc-windows-msvc    # Windows
rustup target add aarch64-apple-darwin       # macOS
```

---

## Clone

```bash
git clone --recurse-submodules https://github.com/hainguyenh/OmniTerm.git
cd OmniTerm
```

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

---

## Install

```bash
pnpm install
```

Uses `pnpm-lock.yaml`. In CI, use `pnpm install --frozen-lockfile`.

---

## Development

```bash
# Basic Tauri dev mode (no plugins)
pnpm tauri:dev:basic

# Full feature dev mode (connection manager plugin)
pnpm tauri:dev:full

# Limited dev mode (batch connections only)
pnpm tauri:dev:limited

# Frontend-only dev server (Vite, sans Tauri)
pnpm dev:frontend
```

---

## Building

```bash
# Full app build (unsigned)
pnpm tauri:build

# Windows NSIS installer (production)
pnpm build:tauri:nsis
```

The installer outputs to `target/release/bundle/nsis/`. `src-tauri` is a member of the
root Cargo workspace, so all build output lands in the workspace-root `target/` — not
in `src-tauri/target/`.

The interactive build wizard also supports a Development profile. It runs
`tauri build --debug`, writes to `target/debug/`, keeps devtools enabled,
and enables Rust `Trace` logging. Choose **Development** in the wizard, or pass
`-Dev` through the Windows wrapper:

```bat
scripts\Build-OmniTerm.cmd -Dev
```

Development app artifacts are written under `artifacts\debug-*` so they do not
overwrite Release artifacts. Use this profile when packaging a reproducible
debug build; use `pnpm tauri:dev:basic` for hot-reload development.

---

## Testing

```bash
# JS/TS unit tests (includes security audit)
pnpm test

# Rust unit tests
pnpm test:tauri

# Security audit only (scans for credential leakage)
pnpm test:security
```

### Security Audit Details

The `test:security` script (`scripts/check-no-password-persistence.mjs`) scans the
entire source tree and enforces:

- No password-related RPC endpoints
- No credential-vault module on disk
- No `password`/`hasPassword` keys in plugin or app code
- No `credentials` permission in any plugin manifest
- No localStorage touching credential or password keys in UI code

Any violation causes a non-zero exit.

### Coverage

```bash
# JS coverage (requires @vitest/coverage-v8)
pnpm add -D @vitest/coverage-v8
pnpm vitest run --coverage

# Rust coverage (requires cargo-llvm-cov)
cargo install cargo-llvm-cov
cargo llvm-cov --manifest-path src-tauri/Cargo.toml
```

---

## Linting

```bash
# ESLint (TypeScript/TSX)
pnpm lint

# Rust Clippy
pnpm lint:tauri
```

ESLint is configured with `--max-warnings 0`. Any warning fails the check.

`pnpm lint:dead-code` rejects orphan TypeScript/Rust modules, Tauri commands that only return a
constant, and Rust commands registered in `generate_handler!` but never invoked by production code.

---

## TypeScript Type Checking

```bash
pnpm tsc -b
```

Uses project references (`tsconfig.json` references `tsconfig.node.json`).

---

## Plugin Development

```bash
# Scaffold a new plugin
pnpm create:plugin my-plugin

# Build a plugin to dist/
pnpm build:plugin ./my-plugin

# Run a plugin in development mode
pnpm run:plugin ./my-plugin

# Install a plugin ZIP into app data
pnpm install:plugin ./my-plugin
```

Plugins are Node.js 24 CommonJS modules communicating over JSON-RPC via stdio
with the Tauri sidecar process. See [docs/PLUGINS.md](docs/PLUGINS.md) for the
full authoring guide.

---

## Project Structure

```
OmniTerm/
  ui/                     # React frontend (TypeScript + Tailwind)
    components/           # UI components
    hooks/                # React hooks
    contexts/             # App state services
    platform/             # Platform abstractions
    security/             # Security verification tools
  crates/
    app-protocol/         # Shared DTOs + protocol types (no Tauri dependency)
      src/                # shell_spec, openshell, session_status
    app-core/             # Domain logic + IO services (no Tauri dependency)
      src/                # launch, safepath, workspace_scan, proc_activity, ...
  src-tauri/              # Tauri Rust backend (desktop adapter)
    src/                  # lib.rs, main.rs, commands, Tauri-bound wrappers
    sidecar/              # Node.js host for plugins (host-api.cjs)
  plugins/
    full-connection-manager/   # SSH/RDP profiles with credential scrubbing
    native-batch-connections/  # Batch-launched SSH/RDP profiles
  contract/               # Shared TypeScript plugin contract (@omniterm/contract)
  docs/                   # PLUGINS.md, CREDENTIAL-AUDIT.md, adr/
  scripts/                # Build utilities (Build-OmniTerm.ps1, plugin scripts)

```

---

## Notes

- `pnpm-lock.yaml` is checked into version control.
- The Tauri app uses `single-instance` -- a second launch routes args to the first window.
- Do not mix npm/yarn with pnpm in this project. Use pnpm exclusively for consistency.
- The markdown-explorer submodule is at `plugins/markdown-explorer`. Update it with
  `git submodule update --remote` from within the workspace.
- Plugins are **unsandboxed** -- they can access `fs`, `net`, `child_process`. Install
  only trusted packages.

---

## Architecture

### Submodule Integration

- Registered in `.gitmodules` under `plugins/markdown-explorer`.
- When a workspace file ends with `.md`/`.markdown`/`.mdx`, OmniTerm's
  `ScriptViewer.tsx` offers a Preview button that switches to `MarkdownPreview.tsx`.
- `MarkdownPreview.tsx` renders using `react-markdown` + `remark-gfm`, imports
  Mermaid dynamically with `securityLevel: 'strict'`, and wraps everything in a
  React `ErrorBoundary` with a 10s timeout.
- markdown-explorer runs inside OmniTerm's webview; it is not loaded as a Tauri plugin.

### Source Map

| Path | Role |
|---|---|
| `crates/app-protocol/src/` | Shared protocol types (DTOs): `shell_spec`, `openshell`, `session_status`; no Tauri dependency |
| `crates/app-core/src/` | Domain logic + IO services: `launch`, `safepath`, `workspace_scan`, `proc_activity`, `rdp_launch`, `win_job`, `tree_validate`, `workspace_launch`; no Tauri dependency |
| `src-tauri/src/` | Tauri 2 Rust shell (desktop adapter); `lib.rs` builds the app, registers commands, re-exports `app_core`/`app_protocol` modules |
| `ui/` | React 18 + TypeScript + Tailwind frontend |
| `contract/index.ts` | Shared TypeScript plugin contract (`@omniterm/contract`, API v2) |
| `plugins/` | Unsandboxed Node.js sidecar plugins |
| `src-tauri/sidecar/host-api.cjs` | Node.js 24 sidecar process entry point |
| `scripts/check-no-password-persistence.mjs` | Automated security audit enforcing zero-credential policy |

### Rust Backend -- Key Modules

| Module | Purpose |
|---|---|
| `lib.rs` | `run()` builds the app, registers state and all Tauri commands |
| `pty.rs` | Core PTY engine. `PtyManager` holds `DashMap<String, PtySession>`. Spawns shells via `CommandBuilder`, streams output through per-session Tauri `Channel` objects |
| `pty_resolve.rs` | Resolves `conn_id` across three tiers: ad-hoc registry, persisted `connections.json`, plugin-host scoped connections |
| `session_output.rs` | Output sink + scrollback buffer (256KiB, newline-aligned). Handles detach/attach without ordering buffer races |
| `connections.rs` | Connection tree CRUD. `Connection` struct has no password field. `scrub_stored_secrets` wipes legacy `password`/`hasPassword` on startup |
| `tree_validate.rs` | Import validation: max 10k records, field length caps, required types, shell parsing via `LocalShell::parse` |
| `safepath.rs` | Path containment: canonical resolve + symlink detection + parent check. Three gate sets: run (allowlist), write (allowlist), view (denylist) |
| `shell_spec.rs` | Closed-set `LocalShell` enum. `parse(s) -> Option<Self>` -- callers treat `None` as rejection |
| `launch.rs` | Converts `LocalLaunch` to `Invocation` (executable + args): `/k /c` (cmd), `-NoExit -Command` (PowerShell), `-- bash -lc <cmd>; exec bash -l` (WSL) |
| `terminal_window.rs` | Panel detach into `term-*` OS window. `DetachRegistry` maps ID -> `DetachedEntry`. Re-attach scrollback replay flow |
| `plugin_host.rs` / `plugin_management.rs` | Node.js sidecar management: JSON-RPC 2.0 over stdin/stdout, ZIP plugin install with atomic rename to `plugins/` |
| `workspace.rs` / `workspace_scan.rs` | Workspace folder scanning, script execution via ad-hoc registry, `.omniterm/connections.json` |
| other (`themes.rs`, `settings.rs`, `app_utils.rs`, `rdp_launch.rs`) | Theme management, settings, external URL control (HTTPS only), RDP embedding |

### Registered Tauri Commands (75+)

**PTY**: `start_local_session`, `send_session_input`, `resize_session`, `disconnect_session`, `prepare_ssh_session`
**Connections**: `load_connections`, `save_connections`, `export_json`, `import_json`, `import_file`
**Workspace**: `scan_scripts`, `scan_workspace_entries`, `read_script`, `write_script`, `load_workspace_connections`, `delete_workspace_connection`
**Windows**: `detach_terminal`, `bootstrap_terminal_window`, `reattach_terminal`, `focus_terminal_window`, `release_terminal_window`
**Plugins**: `install_plugin_package`, `remove_plugin`, `restart_app`, `plugin_invoke`, `plugin_auth_gate`
**Utilities**: `minimize_window`, `toggle_maximize`, `get_version`, `reveal_log` (debug only), `list_themes`, `save_theme`, `change_font`

### Frontend -- Key Components

| Component | Role |
|---|---|
| `main.tsx` / `App.tsx` | Root render + init. Manages settings, themes, layout, zoom, global shortcuts, detached-window detection |
| `omnitermAPI.ts` | Frontend API boundary. `window.omnitermAPI` wraps all `invoke` calls |
| `tauriSessions.ts` | Per-session IPC streaming via `Channel` objects (binary data + lifecycle status per pane) |
| `MainLayout.tsx` | Central workspace: tab bar, activity bar, pane grid, sidebar, dialogs |
| `TerminalView.tsx` | xterm.js embed: resize, input, session start, status mapping |
| `MarkdownPreview.tsx` | Markdown + Mermaid renderer (react-markdown + remark-gfm + dynamic mermaid) |
| `ScriptViewer.tsx` | File viewer/editor; syntax-highlighted; edit mode for `.ps1`/`.sh`/`.bat`/`.cmd` |
| `ConnectionForm.tsx` | Connection editor with host, port, user, shell, command, keepOpen -- no password field |
| `PluginManager.tsx` | Plugin enable/disable, select connection provider |
| `WorkspacePanel.tsx`, `CommandPalette.tsx` | Folder tree + command search (`Ctrl+K`) |

### IPC Architecture

- **Synchronous commands**: Via `invoke()` through `omnitermAPI` for data CRUD (e.g. `load_connections`).
- **Session streaming**: Each PTY session gets two dedicated `Channel` objects (`onData` for binary PTY output, `onStatus` for lifecycle/activity events). No global event bus per session -- cross-pane snooping is structurally impossible.
- **Broadcast events**: Reserved for `shell-open` (tab create), `terminal-window-reattached`, `maximized-state`.
- **Detached windows**: Assigned via `term-<int>` label prefix. Detached webview cannot query other windows session IDs; label resolution is Rust-side only.

### Plugin System

- **Process model**: Node.js 24 sidecar spawned by Rust `PluginHost`. Communication: line-delimited JSON-RPC 2.0 over stdin/stdout.
- **Compatibility gate**: `package.json` must declare `omnitermPlugin.apiVersion === 2`. Permissions validated against 6 known categories before `require()`.
- **Host API** (provided to `activate()`): `plugin.id`/`version`/`permissions`, `service.storageDir`/`log`/`openExternal`/`writeClipboard`, `registerConnectionProvider`, `registerWorkspaceProvider`, `registerAuthProvider`, `registerInvokeHandler`.
- **Reverse calls**: Rust handles `host.openExternal` (HTTPS only, no `@` in authority, no control chars/whitespace) and `host.log`.
- **Plugin install**: User picks ZIP via native file dialog. OmniTerm validates manifest, extracts to `.install-<UUID>`, atomically renames into `plugins/`. No webview-initiated install path.

### Security Hardening

| Pattern | Enforcement |
|---|---|
| Password-free | No password field in connection struct; legacy `password`/`hasPassword` keys scrubbed at startup; no credential RPC anywhere |
| Import validation | `tree_validate.rs` = single choke point for all connection imports: max 10k records, capped string fields, rejects unknown LocalShell variants |
| Path containment | `safepath.rs` canonical + symlink resolve + `is_inside` containment check; three gate rings (run/write/view) with allowlist/denylist per gate |
| Plugin gating | `host-api.cjs` checks required permissions before every operation; JSON-RPC filtered by HTTPS + host pattern checks |
| No stored SSH creds | `prepare_ssh_session` sets `BatchMode=no`; credentials typed in-band via PTY, never stored |
| Logless release | `release_max_level_off` removes all log call sites at compile time; `reveal_log` returns error in release builds |
| Webview CSP | Strict default-src 'self' + named schemes only; `unsafe-inline` for xterm.js CSS injection |

### Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 (Rust) |
| UI framework | React 18 + TypeScript + Tailwind CSS + Lucide icons |
| Terminal | xterm.js 5.5 + `@xterm/addon-fit` |
| PTY transport | `portable-pty` v0.8 (Rust) |
| Plugin host | Node.js 24 sidecar, JSON-RPC v2.0 over stdio |
| Rust crates | serde, tokio, sysinfo, dashmap, opener, rfd |
| Installer | Tauri NSIS (Windows) |
| License | LGPL-3.0-or-later |
| Platform min | Windows 10+ (WSL2 for Linux shells), macOS 12+ |