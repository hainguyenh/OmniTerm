/**
 * The renderer's only diagnostic sink — and in a packaged build, a set of no-ops.
 *
 * A release or portable OmniTerm writes nothing anywhere: no log file (see src-tauri/src/lib.rs and
 * Cargo.toml's `release_max_level_off`), and nothing to a console either. Getting that second half
 * right cannot be left to the bundler: `esbuild.drop` is silently ignored under Vite 8, which minifies
 * with Oxc rather than esbuild, so a build configured to strip `console.*` shipped 33 of them anyway.
 * So the renderer does not rely on a build flag — the calls themselves go nowhere.
 *
 * Use `diag.*` instead of `console.*` in app code; the `no-console` ESLint rule enforces it. And
 * because dependencies (xterm, React) log on their own, `silenceConsole()` shuts the console itself in
 * a packaged build.
 */

/** True only under `vite dev` / `tauri dev` — and in the vitest run, which keeps its output. */
export const DIAGNOSTICS_ENABLED: boolean = import.meta.env.DEV

type Sink = (...args: unknown[]) => void

const noop: Sink = () => {}

export const diag: { log: Sink; info: Sink; warn: Sink; error: Sink; debug: Sink } =
  DIAGNOSTICS_ENABLED
    ? {
        log: (...a) => console.log(...a),
        info: (...a) => console.info(...a),
        warn: (...a) => console.warn(...a),
        error: (...a) => console.error(...a),
        debug: (...a) => console.debug(...a),
      }
    : { log: noop, info: noop, warn: noop, error: noop, debug: noop }

/**
 * Every console method the platform is known to expose. `Object.keys(console)` alone is not enough:
 * whether the methods are own enumerable properties or live on a prototype differs by engine, and a
 * method missed here is a line that still reaches a devtools console.
 */
const CONSOLE_METHODS = [
  'assert', 'clear', 'count', 'countReset', 'debug', 'dir', 'dirxml', 'error', 'group',
  'groupCollapsed', 'groupEnd', 'info', 'log', 'profile', 'profileEnd', 'table', 'time',
  'timeEnd', 'timeLog', 'timeStamp', 'trace', 'warn',
] as const

/**
 * Replaces every function on `target` with a no-op. Returns how many it replaced.
 *
 * Exported separately from `silenceConsole` so it can be exercised against a stand-in object: the test
 * run is itself a dev build, where `silenceConsole` deliberately does nothing.
 */
export function neuterConsole(target: Record<string, unknown>): number {
  const names = new Set<string>([...CONSOLE_METHODS, ...Object.keys(target)])
  let count = 0
  for (const name of names) {
    if (typeof target[name] !== 'function') continue
    try {
      target[name] = noop
      count += 1
    } catch {
      // A non-writable console method (no known engine has one) stays as it is. There is nothing
      // useful to report here, and reporting it would defeat the purpose.
    }
  }
  return count
}

/**
 * Closes the global console in a packaged build; a no-op in development.
 *
 * Called first thing in main.tsx — before the Tauri bridge and before any component mounts — so no
 * dependency gets a line out ahead of it.
 */
export function silenceConsole(): number {
  if (DIAGNOSTICS_ENABLED) return 0
  return neuterConsole(globalThis.console as unknown as Record<string, unknown>)
}
