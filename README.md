
# ⚡ OmniTerm

**A multi-window terminal hub for Windows and macOS**

*Local, SSH and RDP sessions — docked, grouped, and under control.*


---

## 🧭 Overview

OmniTerm is a desktop app built with **Tauri (Rust) + React** for running and organizing multiple
terminal-style sessions side by side, instead of juggling a pile of loose windows.

It is deliberately thin at the core. Saved connections, credential policy, workspace contents and
authentication are all things a plugin can take over, so a deployment can change them without forking
the app — see **[docs/PLUGINS.md](docs/PLUGINS.md)**.

## ✨ Basic Features

- 🖥️ **Local terminal** sessions powered by `xterm.js`
- 🧩 **Multi-window docking** — group and arrange sessions in one layout, or detach a pane into its own window
- 🗂️ **Connection manager** — a tree of saved local / SSH / RDP connections
- 📁 **Workspaces** — pin project folders, browse their scripts, and keep connections alongside the project
- 📂 File browser + script viewer alongside your sessions
- ⌨️ Command palette for quick actions
- 🎨 Theme customization
- 🔌 **Plug-and-play plugins** — drop one in to replace how connections, credentials or workspaces work

## 🔒 No stored passwords

OmniTerm never saves a password, in any form, anywhere — not in a settings file, not in the connection
tree, not in a generated `.rdp` file, not on a command line, and not in a log. The `Connection` type has
no field for one, so this is enforced by construction rather than by discipline. A connection either
prompts you per session, or points at where you keep the password so you can copy it from your own vault.

A plugin that wants to store secrets must bring its own storage, and owns the consequences. See the
credential section of [docs/PLUGINS.md](docs/PLUGINS.md).

## 🧱 Tech Stack

| Layer | Tech |
|---|---|
| Shell | Tauri 2 (Rust) |
| UI | React + TypeScript |
| Terminal rendering | xterm.js |
| Plugin host | Node.js sidecar, JSON-RPC over stdio |

## 🚀 Getting Started

```bash
corepack pnpm install
pnpm create:app             # check your toolchain and print the build sequence

pnpm tauri:dev:basic        # plugin-free app
pnpm tauri:dev:full         # app + Full Remote Suite
pnpm tauri:dev:limited      # app + Limited Connections
pnpm tauri:build            # build the installer

corepack pnpm lint          # eslint (zero warnings tolerated)
corepack pnpm lint:tauri    # clippy with -D warnings
corepack pnpm test          # vitest suite
corepack pnpm test:tauri    # Rust suite
```

> Tests and lint run under `corepack pnpm`; the Tauri builds run under plain `pnpm`. The two are not
> interchangeable here.

## 🔌 Plugins

```bash
pnpm create:plugin my-plugin      # scaffold
pnpm build:plugin ./my-plugin     # compile, and check the host could load it
pnpm run:plugin ./my-plugin       # load it in the real plugin host, print what the app would see
pnpm install:plugin ./my-plugin   # install it, after telling you what it wants
```

Nontechnical users can open **Settings → Plugins → Install ZIP** in any build, including Basic, and
choose a plugin package produced by the build wizard. OmniTerm validates the archive, shows the
requested permissions in a native confirmation, and provides **Remove plugin** for user-installed
packages.

`run:plugin` is the inner loop: it runs the actual sidecar, so `status: loaded` there means the app will
load it too — no build, no restart. Add `--invoke <method> '[args]'` to call into your plugin.

Full authoring guide, permission table and credential policy: **[docs/PLUGINS.md](docs/PLUGINS.md)**.
The API itself is documented in [`contract/index.ts`](contract/index.ts). The two optional providers
live in [`plugins/full-connection-manager`](plugins/full-connection-manager) and
[`plugins/native-batch-connections`](plugins/native-batch-connections) (Limited Connections).

For a guided installer or plugin build, double-click
[`scripts/Build-OmniTerm.cmd`](scripts/Build-OmniTerm.cmd). It offers Basic App, Plugin Package, and
App with Plugin builds without editing tracked configuration. App builds can produce an installer,
an install-free portable ZIP, or both. Portable builds still use the normal Windows user-profile
locations for settings and application data.

## 📌 Status

Early stage, actively evolving. Feedback and ideas welcome.
