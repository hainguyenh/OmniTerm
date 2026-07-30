# OmniTerm

An offline, multi-window SSH/RDP/local terminal and connection manager.

Built with Tauri (Rust) + React. OmniTerm uses a native PTY backend for per-session
performance, stores zero credentials, supports detachable multi-window panes, and
offers an optional plugin system for connection metadata, workspace content, and
app-open auth gates.

For installation, prerequisites, building, and development workflows, see
[GUIDELINE.md](GUIDELINE.md).

---

## Purpose

Terminal managers commonly either hardcode saved credential storage or embed a full
browser engine for a single pane. OmniTerm takes a different approach:

- **Zero credential storage** -- No password field, vault module, save-password API,
  or credential RPC. SSH and RDP authentication happens in-band at session start
  and is never written to disk.
- **Native PTY backend** -- Rust `portable-pty` / ConPTY with xterm.js rendering.
  No Electron, no browser-engine-per-pane. Only a Tauri webview for the UI shell.
- **Multi-window panes** -- Detach a terminal into its own OS window, re-attach it
  later. The PTY stays owned by Rust; output routing switches internally per-pane.
- **Plugin system** -- Unsandboxed Node.js sidecar. Plugins provide connection metadata,
  workspace content, and app-open auth gates. Install only trusted packages.

---

## Terminal Engine

| Capability | Detail |
|---|---|
| Local shells | ConPTY (Windows), portable-pty (macOS/Linux); xterm.js frontend |
| Shell detection | PowerShell, pwsh 7, CMD, WSL, bash, zsh, sh, default login shell |
| SSH sessions | Metadata profiles; `ssh.exe` runs in-pane with native auth prompt |
| RDP sessions | Metadata profiles; temp `.rdp` files launched via native client |
| Quick shells | CLI trigger `--open-shell` for ad-hoc panes |
| Session metrics | Host CPU, RAM, disk usage, and live uptime chips per pane (SSH) |
| Busy/idle | Process-tree probe via `sysinfo` detects active child processes |

### Connection Types

| Type | Profiles |
|---|---|
| LOCAL | PowerShell, pwsh 7, CMD, WSL, bash, zsh, sh, default login shell |
| SSH | Host, port, username, optional shell, cwd, command, args, keepOpen |
| RDP | Host, port, username, optional redirectDrives, resolution settings |

## Multi-Window

| Capability | Detail |
|---|---|
| Detach | Pop a pane into its own `term-*` system window; PTY stays in Rust |
| Re-attach | Fold detached window back into main tab; scrollback replayed up to 256KB |
| Layouts | 1, 2, 3, 4, 6, 8-pane grids with drag-to-resize for 2/3 modes |
| Hotkeys | `Ctrl+1` ... `Ctrl+8` for respective layout modes |

## UI

| Component | Detail |
|---|---|
| Workspace panel | Pin folders; filtered tree of scripts, files, and workspace connections |
| File viewer/editor | Syntax highlighting; editable `.ps1`/`.sh`/`.bat`/`.cmd` with `Ctrl+S`; Markdown + Mermaid preview |
| Command palette | `Ctrl+K`; favorites, recent, fuzzy-search, instant connect |
| Themes | Dark/light toggle; 16-color terminal + 6-color UI palette; JSON import/export, theme remix editor |
| Font & zoom | Monospace family, font size, CSS-level zoom |

## Security

| Property | Detail |
|---|---|
| Password-free | No password field, vault, save API, or credential RPC in source |
| Scrubbers | Legacy `password`/`hasPassword` keys wiped at read time (app + plugins) |
| Logless release | `release_max_level_off` in Rust; zero log output in release builds |
| CSP | Strict Content-Security-Policy; self and named schemes only |
| Theme validation | Theme id restricted to alphanum + `-_.` to prevent traversal |
| Single instance | `tauri-plugin-single-instance` routes second launch to first window |
| Temp cleanup | Stale `.rdp` files deleted on app startup |

## Keyboard Shortcuts

| Keys | Action |
|---|---|
| `Ctrl+K` | Command palette |
| `Ctrl+N` | New session |
| `Ctrl+,` | Settings |
| `Ctrl+/` | Toggle dark/light theme |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+=` / `Ctrl+-` | Zoom in/out |
| `Ctrl+1` ... `Ctrl+8` | Layout modes (1..8 panes) |
| `Ctrl+L` | Lock screen |
| `Escape` | Close modal/palette |

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 (Rust) |
| UI | React 18 + TypeScript + Tailwind CSS + Lucide icons |
| Terminal rendering | xterm.js 5.5 + addon-fit |
| PTY transport | portable-pty v0.8 (Rust) |
| Plugin host | Node.js 24 sidecar, JSON-RPC over stdio |
| Rust crates | serde, tokio, sysinfo, dashmap, zeroize, opener, rfd |
| Installer | Tauri NSIS bundle (Windows) |
| License | LGPL-3.0-or-later |
| Min OS | Windows 10+ (WSL2 for Linux shells), macOS 12+ |

## Plugins

OmniTerm plugins are unsigned Node.js packages loaded by a sidecar process.
Three optional provider types exist:

- **ConnectionProvider** -- Connection metadata tree and connection profiles
- **WorkspaceProvider** -- Workspace scripts, file scanning, and path management
- **AuthProvider** -- Optional app-open gate before revealing the workspace

Bundled providers:
- `plugins/full-connection-manager` -- workspace-aware SSH/RDP profiles with credential scrubbing
- `plugins/native-batch-connections` -- batch-launched SSH/RDP profiles via native client flows

Plugins are **unsandboxed** (access to `fs`, `net`, and `child_process`). Install only
trusted packages. Manage plugins via **Settings > Plugins** or CLI commands in [GUIDELINE.md](GUIDELINE.md).

## Integration

OmniTerm does not embed [markdown-explorer](https://github.com/the-long-ride/markdown-explorer).
It uses the markdown-explorer submodule at `plugins/markdown-explorer` to power Markdown
and Mermaid preview inside the file viewer. See the markdown-explorer [GUIDELINE.md](plugins/markdown-explorer/GUIDELINE.md).

## Status

Early stage. API contract version 2. Active development.

Contributions welcome under LGPL-3.0.