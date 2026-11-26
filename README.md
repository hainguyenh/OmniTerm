# OmniTerm

An offline, multi-window SSH/RDP/local terminal and connection manager.

Built with Tauri (Rust) + React. Native PTY backend, zero credential storage,
detachable multi-window panes, and WebAssembly IDE plugins.

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
- **Layout restart** -- OmniTerm saves terminal pane/view-group placement and each pane's latest
  working directory. Closing the app terminates its terminal processes; the next launch recreates
  fresh shells in the saved directories instead of resuming process state or terminal output.
- **Plugin system** -- Sandboxed WebAssembly components (`wasm32-wasip2`) loaded by the IDE
  plugin host. Official plugins live in `plugins/official`; the Rust SDK is in `plugins/sdk`.

---

## Plugins

OmniTerm plugins are WebAssembly components built against the `wit/` worlds. Official plugins
are in `plugins/official`, built with `bash plugins/build.sh`, and bundled into the app by
`scripts/stage-builtin-plugins.mjs`. See [plugins/README.md](plugins/README.md).

Agent Quota and Always Awake are built into the app and listed as built-in features in the Plugins
dialog, where each can be switched off.

### Always Awake

The Always Awake control is available from the Activity Bar below Files. It supports **Keep awake
always** and **Keep awake when active** modes, with schedules ending today, 24 hours from now, or
next Monday at 08:00 local time. Active-only mode uses LOCAL process-tree activity and conservatively
treats a connected SSH PTY as active; the feature is Windows-first.

Manage plugins via **Settings > Plugins**.

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

Hook bypasses hide both the Test Gate and repository identity checks. Do not use one unless the
person responsible for the repository explicitly authorizes that exact push:

```
git push --no-verify
```
