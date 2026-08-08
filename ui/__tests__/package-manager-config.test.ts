/**
 * Guards on the release plumbing itself — the parts no unit test would otherwise touch and no
 * developer runs locally, so a broken reference only surfaces when a release is already in flight.
 *
 * Two classes of bug this exists to catch, both of which the repo has actually shipped:
 *   * the workflow invoking a `pnpm` script that does not exist in package.json;
 *   * an Electron-era path (`release/`, `dist-electron/`, `tauri/target`) surviving in config after
 *     the host it belonged to was removed.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function readRepoFile(...parts: string[]) {
  return readFileSync(path.join(repoRoot, ...parts), "utf8");
}

const packageJson = JSON.parse(readRepoFile("package.json")) as {
  version: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const workflow = readRepoFile(".github", "workflows", "build-release.yml").replace(/\r\n/g, "\n");
const qualityWorkflow = readRepoFile(".github", "workflows", "test-gate.yml").replace(/\r\n/g, "\n");

describe("release configuration", () => {
  it("pins the repo Node engine to 24+", () => {
    expect(packageJson.engines?.node).toBe(">=24");
  });

  it("installs pnpm before setup-node enables the pnpm cache", () => {
    // `cache: pnpm` makes setup-node shell out to pnpm, so an earlier pnpm/action-setup is required.
    const jobs = workflow
      .split(/\n {2}(?=[a-z-]+:\n)/)
      .filter((job: string) => job.includes("cache: pnpm"));
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.indexOf("name: Set up pnpm")).toBeGreaterThan(-1);
      expect(job.indexOf("name: Set up pnpm")).toBeLessThan(job.indexOf("cache: pnpm"));
    }
  });

  it("only invokes pnpm scripts that exist", () => {
    const invoked = [...workflow.matchAll(/\bpnpm (?!install|exec|dlx)([\w:]+)/g)].map((m) => m[1]);
    expect(invoked.length).toBeGreaterThan(0);
    for (const script of new Set(invoked)) {
      expect(packageJson.scripts?.[script], `workflow runs "pnpm ${script}"`).toBeDefined();
    }
  });

  it("only invokes repo scripts that exist", () => {
    const scripts = [...workflow.matchAll(/node (scripts\/[\w.-]+)/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(() => readRepoFile(...script.split("/"))).not.toThrow();
    }
  });

  it("builds the Tauri installer and publishes it from the real bundle path", () => {
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toContain("pnpm build:tauri:nsis");
    // Where that bundle path is, and that every consumer agrees on it, is derived from the Cargo
    // workspace in cargo-workspace-layout.test.ts — hardcoding it here is what let f4f0efa's
    // target-dir move reach a release unnoticed.
    expect(workflow).not.toMatch(/[^-]\btauri\/target\//);
    expect(workflow).toContain("Tauri NSIS artifact was not produced");
    expect(workflow).toContain("name: OmniTerm-Tauri-Windows-nsis");
  });

  it("gates the build on the reusable renderer, Rust, lint, and coverage workflow", () => {
    expect(workflow).toMatch(/quality-gate:[\s\S]*uses:\s+\.\/\.github\/workflows\/test-gate\.yml/);
    expect(workflow).toMatch(
      /build-desktop-packages:[\s\S]*needs:\s*\[quality-gate, resolve-release-version\]/,
    );
    expect(workflow).not.toMatch(/\n {2}(?:test-gate|rust-test-gate):/);
  });

  it("enforces an 85% coverage threshold across JS and Rust plus their combined total", () => {
    expect(packageJson.scripts?.["coverage:js"]).toContain("vitest run --coverage");
    expect(qualityWorkflow).toContain("Coverage — full source 85%");
    expect(qualityWorkflow).toContain("--js artifacts/coverage-js/coverage-summary.json");
    expect(qualityWorkflow).toContain("--rust artifacts/coverage-rust/coverage-summary.json");
    expect(qualityWorkflow).toContain("--threshold 85");
  });

  it("creates the release page only after the artifacts finish", () => {
    expect(workflow).toMatch(
      /create-release-page:[\s\S]*needs:\s*\[resolve-release-version, build-desktop-packages\]/,
    );
    expect(workflow).toContain("if: needs.resolve-release-version.outputs.skip != 'true'");
    expect(workflow).toContain("fail_on_unmatched_files: true");
  });

  it("refuses to publish a version that disagrees with the one it builds", () => {
    // A tag push publishes what is checked in, so the two must already agree.
    expect(workflow).toContain("does not match package.json version");
    // A manual run resolves the version itself and stamps it into all three files, so the check is
    // that the stamp landed — not that the version was already written by hand.
    expect(workflow).toMatch(/Stamp the release version[\s\S]*sync-tauri-version\.mjs write/);
    expect(workflow).toMatch(/Validate Tauri release metadata[\s\S]*sync-tauri-version\.mjs validate/);
  });

  it("refuses to re-publish a tag that has already shipped", () => {
    // Without this, a run that resolves an already released tag makes action-gh-release replace that
    // release's assets in place: the run goes green and no new release appears.
    expect(workflow).toContain("Releasing it again would overwrite");
    expect(workflow).toContain("next-release-version.mjs");
  });

  it("attaches the installer, the portable package and the plugin to the release", () => {
    for (const name of [
      "OmniTerm-Tauri-Windows-nsis",
      "OmniTerm-Windows-portable",
      "OmniTerm-Plugin-always-awake",
    ]) {
      expect(workflow, `${name} is never uploaded`).toContain(`name: ${name}`);
    }
    expect(workflow).toContain("release-artifacts/**/*.zip");
    // download-artifact merges by this pattern; an upload named outside it is silently dropped.
    expect(workflow).toContain("pattern: OmniTerm-*");
  });

  it("keeps every file that carries the release version in agreement", () => {
    const tauriConf = JSON.parse(readRepoFile("src-tauri", "tauri.conf.json")) as { version: string };
    const cargoVersion = readRepoFile("src-tauri", "Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m);

    expect(cargoVersion).not.toBeNull();
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(tauriConf.version).toBe(packageJson.version);
    expect(cargoVersion?.[1]).toBe(packageJson.version);
  });

  it("carries no Electron host remnants", () => {
    const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    for (const dep of ["electron", "electron-builder", "vite-plugin-electron", "ssh2", "koffi"]) {
      expect(allDeps[dep], `${dep} should be gone with the Electron host`).toBeUndefined();
    }
    expect(Object.values(packageJson.scripts ?? {}).join(" ")).not.toContain("electron-builder");
    expect(workflow).not.toContain("target: electron");
    expect(readRepoFile("vite.config.ts")).not.toContain("vite-plugin-electron");
    expect(readRepoFile("tsconfig.json")).not.toContain('"electron"');
    expect(readRepoFile("vitest.config.ts")).not.toContain("electron/**");
  });

  it("bundles renderer logo instead of resolving it from filesystem root", () => {
    const appLogo = readRepoFile("ui", "assets", "appLogo.ts");
    const buildRs = readRepoFile("src-tauri", "build.rs");
    const indexHtml = readRepoFile("index.html");

    expect(appLogo).toMatch(/import\s+appLogo\s+from\s+['"]\.\.\/generated\/OmniTerm-Logo\.webp['"]/);
    expect(appLogo).not.toContain("'/OmniTerm-Logo.png'");
    expect(buildRs).toContain("cargo:rerun-if-changed=icons/icon.ico");
    expect(indexHtml).toContain('href="/ui/generated/OmniTerm-Logo.webp"');
    expect(packageJson.scripts?.["assets:generate"]).toBe("node scripts/generate-app-assets.mjs");
    expect(packageJson.devDependencies?.potrace).toBeUndefined();
  });
});
