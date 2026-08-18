import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
//
// Tauri is the only host, so this is a plain renderer build: Tauri serves `dist/` in production and
// proxies `devUrl` (this dev server) in development. The port is fixed and `strictPort` is on because
// src-tauri/tauri.conf.json hard-codes http://localhost:5173 — silently falling back to 5174 would
// leave `tauri dev` pointed at nothing. A crashed/killed `tauri dev` (often the VS Code debugger
// tearing it down) can orphan a vite still holding 5173, so `pnpm dev:frontend` runs
// scripts/free-dev-port.mjs first to reclaim it before this strictPort check trips.
//
// No `esbuild: { drop: ['console'] }` here, deliberately. A packaged build must emit no diagnostics,
// but Vite 8 minifies with Oxc, not esbuild, and accepts the `esbuild` option without applying it — a
// build configured that way still shipped 33 `console.*` calls. The guarantee lives in the source
// instead: app code calls `diag` (no-ops when not DEV) and `silenceConsole()` closes the console for
// dependencies too. See ui/diag.ts.
//
// Cargo's `target/` directory holds build-script `.exe` files Windows locks while
// `cargo build` links them; `fs.watch()` on a locked `.exe` throws EBUSY, which
// chokidar re-emits as an unhandled 'error' (its `_handleError` only swallows
// ENOENT/ENOTDIR/EPERM/EACCES) and crashes `tauri dev` ("beforeDevCommand terminated
// with a non-zero status code").
//
// The matcher must ignore the `target` directory itself, not just its
// contents. chokidar installs `fs.watch` on every non-ignored directory, and
// on Windows that watcher fires events for changes anywhere in the subtree:
// when cargo links a deep `target/debug/build/<crate>/...exe`, the event
// reaches `_handleFile → fs.watch(.exe)` → EBUSY. Ignoring the bare `target`
// dir means no directory watcher is installed, so no subtree events reach a
// locked file.
//
// A function (not the `**/target/**` glob) because that glob also misses the
// bare `target` directory (the trailing `/**` requires a path segment after
// `target/`), so it suffers the same EBUSY. The `([/\\]|$)` trailing
// alternative matches the bare dir, a subpath, or a file inside it. anymatch
// preserves function matchers verbatim and normalizes the test path to
// forward slashes before calling them, so `[\\/]` matches either separator.
// Cargo has its own watcher (the "Watching … for changes" lines `tauri dev`
// prints), so this costs nothing Rust-side.
const isCargoTarget = (path: string): boolean => /(^|[/\\])target([/\\]|$)/.test(path)

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Patch artifacts can be locked by editors/apply tools on Windows; they are not
      // app inputs either.
      ignored: ['**/*.patch', isCargoTarget],
    },
  },
  plugins: [react()],
  optimizeDeps: {
    entries: ['index.html'],
  },
})
