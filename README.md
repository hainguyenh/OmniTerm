# OmniTerm

An offline, multi-window SSH/RDP/local terminal and connection manager.

Built with Tauri (Rust) + React. Native PTY backend, zero credential storage,
detachable multi-window panes, and an optional plugin system for connection
metadata, workspace content, and app-open auth gates.

For installation, prerequisites, building, and development workflows, see
[GUIDELINE.md](GUIDELINE.md). For engine details, security model, and tech
stack, see [plugins/markdown-explorer/GUIDELINE.md](plugins/markdown-explorer/GUIDELINE.md).

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

---

## Integration

OmniTerm does not embed [markdown-explorer](https://github.com/the-long-ride/markdown-explorer).
It uses the markdown-explorer submodule at `plugins/markdown-explorer` to power Markdown
and Mermaid preview inside the file viewer. See the markdown-explorer [GUIDELINE.md](plugins/markdown-explorer/GUIDELINE.md).