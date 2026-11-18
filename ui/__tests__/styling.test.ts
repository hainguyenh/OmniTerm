import fs, { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

describe("styling regression check", () => {
  it("forces var(--theme-font-mono) on .xterm and its descendants to prevent overlapping/bleeding characters", () => {
    const cssPath = path.join(ROOT, "ui", "index.css");
    const content = fs.readFileSync(cssPath, "utf8");
    
    // Check that we override font family for xterm container and children
    expect(content).toMatch(/\.xterm,\s*\.xterm\s+\*/);
    expect(content).toContain("font-family: var(--theme-font-mono) !important;");
  });

  // The rule above forces the APP-WIDE font onto every `.xterm *`, but xterm measures its character
  // cell from the PER-PANE font — when they diverge, glyphs are measured at one width and drawn at
  // another. This more specific rule (still `!important`, but two classes beat one) has to exist
  // and win without touching the rule pinned above.
  it("scopes the xterm font to a per-pane variable that outranks the app-wide one", () => {
    const cssPath = path.join(ROOT, "ui", "index.css");
    const content = fs.readFileSync(cssPath, "utf8");

    expect(content).toMatch(/\.terminal-pane\s+\.xterm,\s*\.terminal-pane\s+\.xterm\s+\*/);
    expect(content).toContain("font-family: var(--pane-font-mono, var(--theme-font-mono)) !important;");
  });

  // `display: none` collapses `.xterm-viewport` to scrollHeight 0; the browser clamps scrollTop to
  // 0 and xterm maps that back onto the buffer, so a background pane receiving output was dragged
  // to the top of its scrollback. It also zeroed clientWidth/Height, forcing a re-fit on every tab
  // switch. Hiding a pane must therefore keep its layout box.
  // Regression: IDE dialogs and popups are portaled to <body>, outside [data-workbench]. The legacy
  // `input { background-color: var(--theme-bg) !important }` rule then took the terminal theme's
  // background and covered the field's inset-shadow frame, so search boxes lost their border and
  // showed the wrong colour in light/dark mode.
  it("keeps the legacy input colours off the IDE's portaled dialogs and popups", () => {
    const content = fs.readFileSync(path.join(ROOT, "ui", "index.css"), "utf8");
    const rule = content.match(/(:is\(input, select, textarea\)[^{]*)\{[^}]*background-color: var\(--theme-bg\) !important/);
    expect(rule?.[1]).toContain("[data-workbench] *");
    expect(rule?.[1]).toContain("[data-ide-surface] *");
    const font = content.match(/(:is\(html, body[^{]*)\{\s*font-family: var\(--theme-font-family/);
    expect(font?.[1]).toContain("[data-ide-surface] *");
  });

  it("hides off-screen panes without collapsing their layout box", () => {
    const cssPath = path.join(ROOT, "ui", "index.css");
    const content = fs.readFileSync(cssPath, "utf8");

    expect(content).toMatch(/\.pane-offscreen\s*\{[^}]*visibility:\s*hidden/);
    expect(content).not.toMatch(/\.pane-offscreen\s*\{[^}]*display:\s*none/);
    expect(content).not.toMatch(/\.pane-offscreen\s*\{[^}]*transform:\s*translateX\(-200vw\)/);
  });

  // A renderer component that Tailwind does not scan still renders — with none of its classes defined.
  // Nothing else catches that: unit tests assert markup, not the generated stylesheet, so a feature
  // modal styled as `max-w-md` came out full-width in the real app and every test stayed green. The
  // config is therefore expanded against the filesystem here rather than string-matched.
  it("scans every built-in feature component", () => {
    const config = fs.readFileSync(path.join(ROOT, "tailwind.config.js"), "utf8");
    const contentGlobs = [...config.matchAll(/"\.\/([^"]+)"/g)].map((match) => match[1]);
    const scanned = new Set(contentGlobs.flatMap((glob) => globSync(glob, { cwd: ROOT })));

    const featureComponents = globSync("ui/features/*/**/*.tsx", { cwd: ROOT })

    // The suite is worthless if it silently stops finding feature components.
    expect(featureComponents.length).toBeGreaterThan(0);
    for (const component of featureComponents) {
      expect(scanned, `${component} is not covered by a Tailwind content glob`).toContain(component);
    }
  });
});
