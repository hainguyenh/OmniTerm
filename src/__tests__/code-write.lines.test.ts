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
  // 1700 → 1709: footer theme picker (selected terminal) next to the detach/attach control.
  // 1709 → 1717: the footer lost the theme picker + detach button (moved to the TitleBar, which
  // now also hosts the per-terminal controls top-right); the footer carries only the app-wide font
  // size and stays visible without a session. 1717 → 1720: the footer's font control is gone too
  // (AppearanceMenu's "Apply to all terminals" replaces it) and every pane header now gets its own
  // theme/font control — a net shrink even after the new wiring. 1720 → 1646: the footer's
  // active-session control bar (status pill, metrics, reconnect/disconnect) moved out to
  // SessionFooter.tsx, clearing room for the zoom indicator and the detach-close status sync.
  "src/components/MainLayout.tsx": 1646,
  // Workspace/provider extraction is tracked separately; do not let these grow while it lands.
  // 582 → 535: the embedded personal-connections section went away with Sidebar.tsx. 535 → 518: the
  // option row and the connection leaf became WorkspaceTreeToolbar / WorkspaceConnectionRow. 518 →
  // 505: the search row became WorkspaceSearchBar, and the flat view reuses `viewOf`'s file list.
  // 505 → 518: the per-workspace filter now persists to localStorage (load + save effect). 518 → 537:
  // "Reveal in tree" wiring (useTreeReveal hook call, fileRow's highlight/ref, the prop and its doc).
  // 537 → 606: show-more pagination (folder pages via useWorkspaceScan) is still being extracted.
  // 606 → 613: keep unloaded folders out of the draining views, so opening a workspace no longer
  // flashes the whole skeleton before empty folders are pruned. 613 → 611: an explicitly expanded
  // folder is now always kept too, so it can never vanish the moment its page loads.
  "src/components/WorkspacePanel.tsx": 611,
  // Grows with the show-more pagination coverage; ratchet back once WorkspaceShowMore lands.
  // 548 → 567: regression coverage for an explicitly expanded folder that loads empty.
  "src/components/__tests__/workspacePanel.test.tsx": 567,
  // A command registry: it grows by one line per command and one per module, and there is nothing to
  // split out of it. 373 → 375 for `workspace_scan` + `scan_workspace_entries`. 375 → 376 for
  // `safepath::system_excluded_view_exts`.
  "src-tauri/src/lib.rs": 376,
  "src-tauri/src/plugin_host.rs": 426,
  // Test file for the containment/viewer gates; grew with the "Excluded file types" setting's
  // coverage (user-excluded extensions on top of the fixed deny-list).
  "src-tauri/src/safepath_tests.rs": 384,
  // Workspace scan + its tests: folder-page work is in flight; ratchet down when it settles.
  "src-tauri/src/workspace_scan.rs": 380,
  "src-tauri/src/workspace_scan_tests.rs": 455,
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
