import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

const LIMITS: Record<string, number> = {
  ".ts": 400,
  ".tsx": 500,
  ".js": 350,
  ".css": 600,
  ".rs": 350,
};

// Grandfathered files that still exceed the limit. The test fails if they grow,
// so any new edits should shrink them or split them.
const BASELINE_OVERRIDES: Record<string, number> = {
  // Ratcheted down as UI moves out: 2176 → 2092 → 2086 → 1978 → 1935 → 1956 → 1700 (personal
  // connection tree, its CRUD and its folder CRUD deleted — connections live in a workspace now).
  "src/components/MainLayout.tsx": 1700,
  // Workspace/provider extraction is tracked separately; do not let these grow while it lands.
  // 582 → 535: the embedded personal-connections section went away with Sidebar.tsx. 535 → 518: the
  // option row and the connection leaf became WorkspaceTreeToolbar / WorkspaceConnectionRow. 518 →
  // 505: the search row became WorkspaceSearchBar, and the flat view reuses `viewOf`'s file list.
  "src/components/WorkspacePanel.tsx": 505,
  // A command registry: it grows by one line per command and one per module, and there is nothing to
  // split out of it. 373 → 375 for `workspace_scan` + `scan_workspace_entries`.
  "src-tauri/src/lib.rs": 375,
  "src-tauri/src/plugin_host.rs": 426,
  // No override for src-tauri/src/workspace.rs: the workspace-connection commands went to
  // workspace_connections.rs and the scan to workspace_scan.rs, so it is well under the limit again.
};

function lineCount(file: string): number {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).length;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && LIMITS[path.extname(entry.name)]) out.push(full);
  }
  return out;
}

describe("code-write.md line limits", () => {
  it("no source file exceeds its extension limit (or tracked baseline)", () => {
    const failures: string[] = [];
    // src-tauri is included so the Rust backend is held to the same ".rs" limit as everything else.
    // The guard declared a ".rs" limit but never walked a directory containing Rust, so it was inert.
    for (const sourceDir of [
      "src",
      "contract",
      "plugins/full-connection-manager/src",
      "plugins/native-batch-connections/src",
      "src-tauri/src",
      "src-tauri/tests",
    ]) {
      const dir = path.join(ROOT, sourceDir);
      for (const full of walk(dir)) {
        const rel = path.relative(ROOT, full).replace(/\\/g, "/");
        const ext = path.extname(full);
        const count = lineCount(full);
        const max = BASELINE_OVERRIDES[rel] ?? LIMITS[ext];
        if (count > max) {
          failures.push(`${rel}: ${count} lines (max ${max})`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
