import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
//
// Tauri is the only host, so this is a plain renderer build: Tauri serves `dist/` in production and
// proxies `devUrl` (this dev server) in development. The port is fixed and `strictPort` is on because
// src-tauri/tauri.conf.json hard-codes http://localhost:5173 — silently falling back to 5174 would
// leave `tauri dev` pointed at nothing.
//
// No `esbuild: { drop: ['console'] }` here, deliberately. A packaged build must emit no diagnostics,
// but Vite 8 minifies with Oxc, not esbuild, and accepts the `esbuild` option without applying it — a
// build configured that way still shipped 33 `console.*` calls. The guarantee lives in the source
// instead: app code calls `diag` (no-ops when not DEV) and `silenceConsole()` closes the console for
// dependencies too. See src/diag.ts.
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  plugins: [react()],
})
