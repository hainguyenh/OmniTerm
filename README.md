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
  workspace content, app-open auth gates, and selected app features. Install only trusted packages.

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
- `plugins/always-awake` -- Always Awake metadata/UI integration backed by the native Windows
  sleep-prevention capability

### Always Awake

The Always Awake control is available from the Activity Bar below Files. It supports **Keep awake
always** and **Keep awake when active** modes, with schedules ending today, 24 hours from now, or
next Monday at 08:00 local time. Active-only mode uses LOCAL process-tree activity and conservatively
treats a connected SSH PTY as active; the feature is Windows-first.

Plugins are **unsandboxed** (access to `fs`, `net`, and `child_process`). Install only
trusted packages. Manage plugins via **Settings > Plugins** or CLI commands in [GUIDELINE.md](GUIDELINE.md).

---

## Integration

OmniTerm does not embed [markdown-explorer](https://github.com/the-long-ride/markdown-explorer).
It uses the markdown-explorer submodule at `plugins/markdown-explorer` to power Markdown
and Mermaid preview inside the file viewer. See the markdown-explorer [GUIDELINE.md](plugins/markdown-explorer/GUIDELINE.md).

## Themes

Built-in themes are JSON files in `src-tauri/builtinThemes/`. User-created themes are stored as JSON
in OmniTerm's application data `themes` folder. Open **Theme Remix** to create, duplicate, and edit
themes, or use its folder button to edit a JSON file externally. Use the reload button after an
external edit; invalid JSON files are ignored by the theme loader.
## Pre-push checks

`master` requires every Test Gate check to pass before a pull request can merge, so a broken push
costs a full CI round trip to find out. A Husky `pre-push` hook runs the same checks locally first
and refuses the push, naming the check that failed and the one command that reproduces it.

```
pnpm check:push          # typecheck, lint + LOC, JS tests, security audit, clippy, cargo test
pnpm check:push --full   # the above plus both coverage jobs and the 85% gate (slow)
```

The hook installs itself via the `prepare` script on `pnpm install`. The coverage jobs are left out
of the default run because Rust coverage needs a nightly toolchain, `cargo-llvm-cov` and minutes of
wall clock; anything skipped is named in the output rather than passed over silently. If `cargo` is
not on PATH the Rust checks are reported as skipped, not as passing.

To push past the hook — CI still enforces the gate, and master will not let a red PR merge:

```
git push --no-verify
```
