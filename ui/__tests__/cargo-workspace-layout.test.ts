/**
 * Guards the one fact that the release pipeline depends on and that no unit test observes: where
 * Cargo writes its build output.
 *
 * `src-tauri` used to be a standalone crate, so its output lived in `src-tauri/target/`. Commit
 * f4f0efa made it a member of a workspace rooted at the repo root, which moved every artifact to
 * the workspace-root `target/`. The release workflow, the Windows build wizard and the docs were
 * not updated, so `Build & Release` shipped green through the build step and then failed at
 * "Confirm Tauri setup artifact exists" — the installer existed, nothing was looking at it.
 *
 * The old guard in package-manager-config.test.ts hardcoded `src-tauri/target/...`, so it passed
 * while asserting the bug. Everything here is therefore *derived* from the root Cargo.toml: if the
 * workspace layout changes again, these assertions move with it and the stragglers fail.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function readRepoFile(...parts: string[]) {
  return readFileSync(path.join(repoRoot, ...parts), "utf8").replace(/\r\n/g, "\n");
}

/** Members of the workspace declared in the root Cargo.toml, in declaration order. */
const WORKSPACE_MEMBERS: string[] = (() => {
  const block = readRepoFile("Cargo.toml").match(/^\s*members\s*=\s*\[([\s\S]*?)\]/m);
  return block ? [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]) : [];
})();

/**
 * Cargo puts `target/` at the *workspace root*. While `src-tauri` is a member that is the repo
 * root, so the prefix is empty; if it is ever unhooked into a standalone crate again the prefix
 * becomes `src-tauri/` and every assertion below flips with it.
 */
const TARGET_PREFIX = WORKSPACE_MEMBERS.includes("src-tauri") ? "" : "src-tauri/";
const BUNDLE_DIR = `${TARGET_PREFIX}target/release/bundle/nsis`;

const workflow = readRepoFile(".github", "workflows", "build-release.yml");
const qualityWorkflow = readRepoFile(".github", "workflows", "test-gate.yml");

/**
 * Any reference to a cargo profile directory, capturing whatever path precedes it. `$Profile` and
 * `$BuildProfile` are the PowerShell wizard's variables for the same thing.
 *
 * Deliberately narrow: `rustup target add x86_64-…` (space, not a separator) and `--all-targets`
 * do not match, and neither does the wizard's unrelated `$targetFull` local.
 */
const TARGET_REFERENCE = /([\w./\\-]*?)target[/\\](release|debug|\$Profile|\$BuildProfile)/g;

/** Files that name a cargo output directory in a path that something actually reads. */
const FILES_NAMING_TARGET_DIR = [
  ".github/workflows/build-release.yml",
  "scripts/Build-OmniTerm.ps1",
  "scripts/ReleasePackaging.ps1",
  "scripts/create-app.mjs",
  "GUIDELINE.md",
];

describe("cargo workspace layout", () => {
  it("parses the workspace members out of the root Cargo.toml", () => {
    // A regex that silently matched nothing would make every assertion below vacuously true.
    expect(WORKSPACE_MEMBERS.length).toBeGreaterThan(0);
    expect(WORKSPACE_MEMBERS).toContain("src-tauri");
  });

  it("declares only members that exist and carry a Cargo.toml", () => {
    for (const member of WORKSPACE_MEMBERS) {
      expect(existsSync(path.join(repoRoot, member, "Cargo.toml")), `${member} is missing`).toBe(
        true,
      );
    }
  });

  it("keeps every reference to the cargo output directory at the workspace root", () => {
    const violations: string[] = [];
    let seen = 0;

    for (const file of FILES_NAMING_TARGET_DIR) {
      const content = readRepoFile(...file.split("/"));
      for (const match of content.matchAll(TARGET_REFERENCE)) {
        seen += 1;
        const prefix = match[1].replaceAll("\\", "/");
        if (prefix === TARGET_PREFIX) continue;
        const line = content.slice(0, match.index).split("\n").length;
        violations.push(`${file}:${line} — "${match[0]}" should start at "${TARGET_PREFIX}target/"`);
      }
    }

    // A rename that emptied the sweep would otherwise leave this test passing on nothing.
    expect(seen).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it("points the cargo build cache at the workspace root", () => {
    const expected = WORKSPACE_MEMBERS.includes("src-tauri") ? "." : "src-tauri";
    const declared = [...`${workflow}\n${qualityWorkflow}`.matchAll(/workspaces:\s*(\S+)/g)];

    expect(declared.length).toBeGreaterThan(0);
    for (const [, workspaces] of declared) expect(workspaces).toBe(expected);
  });

  it("keeps exactly one Cargo.lock, at the workspace root", () => {
    // Cargo ignores a member's own lockfile, so one left behind drifts forever — and
    // Swatinem/rust-cache would key its cache on that dead file.
    expect(existsSync(path.join(repoRoot, "Cargo.lock"))).toBe(true);
    for (const member of WORKSPACE_MEMBERS) {
      expect(
        existsSync(path.join(repoRoot, member, "Cargo.lock")),
        `${member}/Cargo.lock is stale — cargo only reads the workspace-root lockfile`,
      ).toBe(false);
    }
  });

  it("verifies and uploads the NSIS installer from the same derived directory", () => {
    const confirmed = workflow.match(/Get-ChildItem -LiteralPath \$bundle/);
    const bundleVar = workflow.match(/\$bundle = '([^']+)'/);
    const uploaded = workflow.match(/path: (\S+)\/\*\.exe/);

    expect(confirmed).not.toBeNull();
    expect(bundleVar?.[1]).toBe(BUNDLE_DIR);
    expect(uploaded?.[1]).toBe(BUNDLE_DIR);
  });

  it("ignores the derived target directory in git", () => {
    const ignored = readRepoFile(".gitignore").split("\n").map((line) => line.trim());
    expect(ignored).toContain(`${TARGET_PREFIX}target/`);
    // The pre-workspace entry must not linger: it reads as if src-tauri/target were still live.
    if (TARGET_PREFIX === "") expect(ignored).not.toContain("src-tauri/target");
  });

  it("runs every script test through pnpm test:quality", () => {
    // test:quality used to enumerate its files by hand, so a newly added script test silently
    // never ran. This assertion lives in a vitest file — which is glob-discovered — because a test
    // under scripts/__tests__ could not detect its own omission.
    const quality = JSON.parse(readRepoFile("package.json")).scripts?.["test:quality"] ?? "";
    // A glob covers every file at once; an explicit list has to name each one.
    const globbed = quality.includes("scripts/__tests__/*.test.mjs");

    const files = readdirSync(path.join(repoRoot, "scripts", "__tests__")).filter((file) =>
      file.endsWith(".test.mjs"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(globbed || quality.includes(file), `${file} is never run by pnpm test:quality`).toBe(
        true,
      );
    }
  });
});
