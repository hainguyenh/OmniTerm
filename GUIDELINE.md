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

The installer outputs to `src-tauri/target/release/bundle/nsis/`.

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
  src/                    # React frontend (TypeScript + Tailwind)
    components/           # UI components
    hooks/                # React hooks
    contexts/             # App state services
    platform/             # Platform abstractions
    security/             # Security verification tools
  src-tauri/              # Tauri Rust backend
    src/                  # lib.rs, main.rs, commands
    sidecar/              # Node.js host for plugins (host-api.cjs)
  plugins/
    full-connection-manager/   # SSH/RDP profiles with credential scrubbing
    native-batch-connections/  # Batch-launched SSH/RDP profiles
  contract/               # Shared TypeScript plugin contract (@omniterm/contract)
  docs/                   # PLUGINS.md, CREDENTIAL-AUDIT.md
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