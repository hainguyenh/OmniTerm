import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

describe("styling regression check", () => {
  it("forces var(--theme-font-mono) on .xterm and its descendants to prevent overlapping/bleeding characters", () => {
    const cssPath = path.join(ROOT, "src", "index.css");
    const content = fs.readFileSync(cssPath, "utf8");
    
    // Check that we override font family for xterm container and children
    expect(content).toMatch(/\.xterm,\s*\.xterm\s+\*/);
    expect(content).toContain("font-family: var(--theme-font-mono) !important;");
  });
});
