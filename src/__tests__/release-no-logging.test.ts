/**
 * A packaged OmniTerm — release installer or portable exe — writes no log and reports nothing about
 * itself. That guarantee lives in build configuration, `cfg` gates and one small module, so nothing
 * else in the suite would notice it being undone.
 *
 * The doors it keeps shut, renderer first:
 *   1. no app code calls `console.*` — diagnostics go through `diag`, which no-ops outside a dev build;
 *   2. the global console is closed at startup, so dependencies cannot log either;
 *   3. the Rust `log::*!` call sites compile to nothing (Cargo.toml);
 *   4. no logger is registered, so no log file is ever created (lib.rs);
 *   5. the log commands touch no filesystem path when logging is off (app_utils.rs).
 *
 * Note what is NOT relied on: `esbuild: { drop: ['console'] }`. Vite 8 minifies with Oxc and ignores
 * that option without complaint — a build configured that way shipped 33 console calls anyway. If the
 * project ever moves back to an esbuild-minified Vite, that flag is a bonus, never the mechanism.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { neuterConsole, DIAGNOSTICS_ENABLED } from "../diag";

const repoRoot = process.cwd();

/** Line endings are normalised so these assertions hold whatever the checkout's autocrlf did. */
function readRepoFile(...parts: string[]) {
  return readFileSync(path.join(repoRoot, ...parts), "utf8").replace(/\r\n/g, "\n");
}

/** Every shipped renderer source — excludes tests, which never reach a build. */
function rendererSources(dir = path.join(repoRoot, "src")): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...rendererSources(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/^(testSetup\.ts|testUtils\.tsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

describe("packaged builds emit no diagnostics", () => {
  it("has no console call anywhere in shipped renderer code except diag.ts itself", () => {
    const offenders: string[] = [];
    for (const file of rendererSources()) {
      const rel = path.relative(repoRoot, file).replace(/\\/g, "/");
      if (rel === "src/diag.ts") continue;
      const source = readFileSync(file, "utf8");
      // Matches calls and bare references alike — `.catch(console.error)` ships a log just as surely.
      for (const m of source.matchAll(/\bconsole\.[a-zA-Z]+/g)) offenders.push(`${rel}: ${m[0]}`);
    }
    expect(offenders, "route these through `diag` from src/diag.ts").toEqual([]);
  });

  it("keeps the no-console lint rule on, so the previous test cannot be defeated by a new file", () => {
    const eslintrc = readRepoFile(".eslintrc.cjs");
    expect(eslintrc).toMatch(/'no-console':\s*'error'/);
    // The exemption must stay narrow: diag.ts plus things that never ship.
    const exempt = eslintrc.match(/files:\s*\[([^\]]*)\]/)?.[1] ?? "";
    expect(exempt).toContain("src/diag.ts");
    expect(exempt).not.toMatch(/'src\/\*|\*\*\/\*\.tsx?'/);
  });

  it("silences the console before anything else in the entry module", () => {
    const main = readRepoFile("src", "main.tsx");
    const silence = main.indexOf("silenceConsole()");
    expect(silence, "main.tsx must call silenceConsole()").toBeGreaterThan(-1);
    // Ahead of the bridge and the first render, or a dependency gets a line out first.
    expect(silence).toBeLessThan(main.indexOf("initTauriBridge()"));
    expect(silence).toBeLessThan(main.indexOf("createRoot"));
  });

  it("neuters console methods whether they are own properties or inherited", () => {
    // The engine difference this guards: in some runtimes console's methods are own enumerable keys,
    // in others they live on a prototype and `Object.keys` misses them entirely.
    const stub = Object.create({ error: () => "leaked", trace: () => "leaked" }) as Record<string, unknown>;
    stub.log = () => "leaked";
    stub.notAFunction = 42;

    const replaced = neuterConsole(stub);

    expect(replaced).toBe(3);
    for (const name of ["log", "error", "trace"]) {
      expect((stub[name] as () => unknown)(), `console.${name} must be silent`).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(stub, name)).toBe(true);
    }
    expect(stub.notAFunction).toBe(42);
  });

  it("covers every console method a runtime is known to expose", () => {
    // A method left off the list in diag.ts is a line that still reaches a devtools console.
    const real = neuterConsole({ ...(console as unknown as Record<string, unknown>) });
    const stub: Record<string, unknown> = {};
    for (const name of Object.getOwnPropertyNames(console)) {
      const value = (console as unknown as Record<string, unknown>)[name];
      if (typeof value === "function") stub[name] = value;
    }
    expect(real).toBeGreaterThan(0);
    expect(neuterConsole(stub)).toBe(Object.keys(stub).length);
  });

  it("keeps diagnostics on for the dev build (and this test run)", () => {
    expect(DIAGNOSTICS_ENABLED).toBe(true);
  });

  it("compiles the Rust log macros away in release (not merely filters them at runtime)", () => {
    expect(readRepoFile("src-tauri", "Cargo.toml")).toMatch(
      /^log\s*=\s*\{[^}]*release_max_level_off/m,
    );
  });

  it("keeps the devtools feature off, so a release build cannot open an inspector", () => {
    const tauriDep = readRepoFile("src-tauri", "Cargo.toml").match(/^tauri\s*=\s*(.+)$/m)?.[1] ?? "";
    expect(tauriDep).toBeTruthy();
    expect(tauriDep).not.toContain("devtools");
  });

  it("registers the log plugin under #[cfg], so release does not compile it in at all", () => {
    const lib = readRepoFile("src-tauri", "src", "lib.rs");
    // `if cfg!(debug_assertions)` would still link the registration in; the attribute cannot.
    expect(lib).toMatch(
      /#\[cfg\(debug_assertions\)\]\s*\n\s*app\.handle\(\)\.plugin\(\s*\n\s*tauri_plugin_log/,
    );
    expect(lib).not.toMatch(/if cfg!\(debug_assertions\)\s*\{\s*\n\s*app\.handle\(\)\.plugin\(/);
  });

  it("returns from the log commands before any filesystem call when logging is off", () => {
    const appUtils = readRepoFile("src-tauri", "src", "app_utils.rs");
    expect(appUtils).toContain("pub const fn logging_enabled() -> bool {\n    cfg!(debug_assertions)");
    // reveal_log used to create_dir_all unconditionally — asking to see the log in a packaged build
    // created a directory. The guard must come first in both commands.
    for (const command of ["reveal_log", "clear_log"]) {
      const body = appUtils.slice(appUtils.indexOf(`pub async fn ${command}(`));
      const guard = body.indexOf("if !logging_enabled()");
      const firstIo = Math.min(
        ...["app_log_dir", "create_dir_all", "read_dir", "fs::write"]
          .map((call) => body.indexOf(call))
          .filter((i) => i !== -1),
      );
      expect(guard, `${command} must check logging_enabled`).toBeGreaterThan(-1);
      expect(guard, `${command} must check before touching the filesystem`).toBeLessThan(firstIo);
    }
  });

  it("hides the Open log control unless this is a dev build", () => {
    expect(readRepoFile("src", "components", "MainLayout.tsx")).toMatch(
      /import\.meta\.env\.DEV && \(\s*\n\s*<button[\s\S]{0,400}revealLog\(\)/,
    );
  });
});
