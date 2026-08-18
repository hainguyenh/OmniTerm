---
id: architecture-dev-server-stability
status: current
area: architecture
navigation: "Internal"
platforms:
  - desktop
  - tauri
tags:
  - vite
  - tauri
  - dev
  - windows
  - build
related:
  - architecture-application-shell
  - architecture-runtime-boundaries
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Architecture Dev Server Stability

## Description

Defines the Windows-only invariants that keep `pnpm dev` / `pnpm tauri dev` survivable across repeated dev cycles: the vite watcher must hide cargo's `target/` directory so `fs.watch()` never reaches a linked `.exe`, and the dev port 5173 must be reclaimed before vite binds it.

## What

- `vite.config.ts` declares `server.watch.ignored: ['**/*.patch', isCargoTarget]` where `isCargoTarget` is a probe function that matches the bare `target` directory, any subpath, or any file inside it.
- `scripts/free-dev-port.mjs` listens on port 5173 before vite binds; if the listen fails with `EADDRINUSE` it resolves the holder's PID from the owning process and sends `SIGTERM` (falling back to `SIGKILL`), then retries until the port is free or it times out.
- The `dev` and `dev:frontend` package scripts preface the Vite command with `pnpm assets:generate && node scripts/free-dev-port.mjs && vite`. `tauri:dev` and `tauri:dev:basic` invoke `pnpm tauri dev`, which reads `beforeDevCommand: "pnpm dev:frontend"` from `src-tauri/tauri.conf.json`, so the same reclaimer runs transitively before the Vite strictPort check rejects the bind.

## Why

- Windows locks build-script `.exe` files while cargo links them. chokidar installs `fs.watch()` on every non-ignored directory, and on Windows a directory watcher fires events for changes anywhere in its subtree: when cargo links a deep `target/debug/build/<crate>/.../build_script_build-*.exe`, the subtree event reaches `_handleFile -> fs.watch(.exe)` and throws `EBUSY`. chokidar's `_handleError` only swallows `ENOENT`/`ENOTDIR`/`EPERM`/`EACCES`; it re-emits `EBUSY` as an unhandled `'error'` event, which crashes vite ("beforeDevCommand terminated with a non-zero status code") and kills `tauri dev`.
- `src-tauri/tauri.conf.json` hard-codes `devUrl: http://localhost:5173` and `vite.config.ts` sets `strictPort: true`; a crashed or killed `tauri dev` (often the VS Code debugger tearing it down) can orphan a vite still holding 5173, so the next start fails loudly at the strictPort check instead of silently falling back to a port the Tauri side is not watching.

## How

- `isCargoTarget` is a function (not a `**/target/**` glob) because the trailing `/**` requires a path segment after `target/`, so the glob misses the bare `target` directory and suffers the same EBUSY. anymatch preserves function matchers verbatim and normalizes the test path to forward slashes before calling them, so the regex `(^|[/\\])target([/\\]|$)` matches the bare dir, a subpath, or a file inside it with either separator.
- Ignoring the bare `target` directory means chokidar installs no directory watcher on it, so no subtree events reach a locked file and the EBUSY never fires. Cargo still has its own change-watcher (the "Watching ... for changes" lines `tauri dev` prints), so hiding the directory from vite costs no Rust rebuild signal.
- `free-dev-port.mjs` does a single listen probe and, if it fails, walks system listening-socket tables locally to find the owning process for 5173 and terminates only that PID. It never matches other ports or other PIDs.

## When

- Every `pnpm dev`, `pnpm dev:frontend`, `pnpm tauri dev`, or `pnpm tauri:dev:basic` startup (the scripts gate the reclaimer).
- Every concurrent `cargo build` during an active vite dev session on Windows (the watcher ignores cargo's link window).

## Behavior

- Vite starts on `http://localhost:5173` only after the port is confirmed free, then holds it under `strictPort: true`.
- The vite watcher option `ignored: ['**/*.patch', isCargoTarget]` ensures no `fs.watch()` is installed on `target/`, no EBUSY reaches chokidar, and `tauri dev` survives concurrent cargo builds.
- Editing `vite.config.ts` requires running `pnpm typecheck` (= `tsc -b`) to regenerate the compiled `vite.config.js` beside it: the git-ignored `.js` is the file vite's config loader prefers over the `.ts`, so a stale `.js` silently shadows edits to the `.ts`. The `.js` is treated as a build artifact, never committed (`.gitignore` line 23: `/vite.config.js`).

## Functionalities

- `isCargoTarget` — owned by this spec.
- `free-dev-port.mjs` — owned by this spec.
- `dev` and `dev:frontend` package scripts — owned by this spec for the reclaimer prefix. (`tauri:dev`/`tauri:dev:basic` inherit the prefix transitively via `beforeDevCommand: "pnpm dev:frontend"` in `src-tauri/tauri.conf.json`.)
- `vite.config.ts` `server.watch.ignored` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `isCargoTarget` | Probe matcher for cargo `target/` paths. | Hide the bare dir + subpaths from chokidar. | Regex `(^|[/\\])target([/\\]|$)` against anymatch-normalized forward-slash paths. | Vite dev watcher scan, repeatedly. |
| `free-dev-port.mjs` | Reclaim port 5173 before vite binds it. | `tauri.conf.json` hard-codes the URL; strictPort would reject an orphaned holder. | Listen probe; on `EADDRINUSE` find the owning PID and `SIGTERM`/`SIGKILL`; retry until free or timeout. | Every dev/tauri script start. |
| `dev` / `dev:frontend` | npm script gateway. | Run the reclaimer before vite and fail loudly if the port stays held. | Each script starts with `pnpm assets:generate && node scripts/free-dev-port.mjs && vite`. | `pnpm dev` / `pnpm dev:frontend` (and `pnpm tauri dev` via `beforeDevCommand`). |
| `server.watch.ignored` | Vite watcher ignore list. | Keep `target/` and `*.patch` artifacts out of `fs.watch()`. | `ignored: ['**/*.patch', isCargoTarget]` in `vite.config.ts`. | Vite dev server start. |

## State and data

- Vite dev port `5173` (fixed; never auto-incremented because of `strictPort: true`).
- Compiled `vite.config.js` (git-ignored build artifact emitted by `tsc -b` from the composite `tsconfig.node.json`; treated as transient, never committed).

## Errors and edge cases

- EBUSY on a locked `.exe` is not in chokidar's `_handleError` swallow list, so it propagates and crashes vite. Ignoring `target/` upstream prevents the throw at its source.
- A stale `vite.config.js` from a prior `tsc -b` shadows edits to `vite.config.ts`. The fix is to run `pnpm typecheck` after editing the `.ts` so the `.js` regenerates.
- `free-dev-port.mjs` times out after a few seconds and exits non-zero so the strictPort check reports the real bind failure rather than hanging silently.
- Bare `pnpm exec vite` bypasses the reclaimer and is unsupported; use one of the package scripts instead.

## Security and invariants

- `free-dev-port.mjs` only terminates the PID it positively identifies as owning a listening socket on port 5173; it never matches other ports or other PIDs.
- The vite watcher hides `target/` only for build art because Cargo keeps its own change-watcher at the project root; hiding the directory in vite costs no Rust rebuild signal.

## Verification

- `scripts/__tests__/dev-instance-config.test.mjs` — asserts `vite.config.ts` keeps `strictPort: true`, `port: 5173`, a `watch.ignored` array literal, the `'**/*.patch'` glob, and the `isCargoTarget` reference.
- `scripts/__tests__/free-dev-port.test.mjs` — asserts the reclaimer returns cleanly when the port is free, recovers it when bound by another process, and aborts when the holder refuses to die.

## Source map

- `vite.config.ts`
- `scripts/free-dev-port.mjs`
- `package.json` (scripts `dev`, `dev:frontend`, `tauri:dev`, `tauri:dev:basic`)
- `scripts/__tests__/dev-instance-config.test.mjs`
- `scripts/__tests__/free-dev-port.test.mjs`
- `tsconfig.node.json` (composite project whose `tsc -b` emits `vite.config.js`)
- `.gitignore` (line 23 ignores `/vite.config.js`)
