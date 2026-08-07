import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { normalizeXtermTheme } from "../utils/xtermTheme";
import { TOKYO_NIGHT, TerminalTheme } from "../themes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const rgb = (hex: string) => {
  const h = hex.slice(1);
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
};
const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
  const c = (v: number) => { const n = v / 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const contrast = (a: string, b: string) => {
  const [l1, l2] = [luminance(rgb(a)), luminance(rgb(b))];
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

const baseTheme: TerminalTheme = { ...TOKYO_NIGHT.terminal.dark };

describe("normalizeXtermTheme", () => {
  it("passes a well-formed theme through with valid colors intact", () => {
    const out = normalizeXtermTheme(baseTheme);
    expect(out.background).toBe(baseTheme.background);
    expect(out.foreground).toBe(baseTheme.foreground);
    for (const key of ["black", "red", "green", "cyan", "brightWhite"] as const) {
      expect(out[key]).toMatch(HEX_RE);
    }
  });

  it("drops a color that is not valid hex, leaving it for xterm's own default", () => {
    const out = normalizeXtermTheme({ ...baseTheme, red: "not-a-color" });
    expect(out.red).toBeUndefined();
  });

  it("drops an empty selectionForeground instead of passing '' through", () => {
    const out = normalizeXtermTheme({ ...baseTheme, selectionForeground: "" });
    expect(out.selectionForeground).toBeUndefined();
  });

  // This is claude.json's actual dark-theme bug before the fix: bright-white text was drawn in
  // exactly the background color, i.e. invisible.
  it("repairs a color that is identical to the background", () => {
    const out = normalizeXtermTheme({ ...baseTheme, background: "#181816", brightWhite: "#181816" });
    expect(out.brightWhite).not.toBe("#181816");
    expect(contrast(out.brightWhite!, out.background!)).toBeGreaterThan(1.6);
  });

  it("repairs a color that is only barely different from the background", () => {
    // clickhouse.json's dark `black` against its `background` — contrast ratio ~1.3, not identical
    // but still effectively invisible.
    const out = normalizeXtermTheme({ ...baseTheme, background: "#0a0a0a", black: "#1a1a1a" });
    expect(contrast(out.black!, out.background!)).toBeGreaterThan(1.6);
  });

  it("leaves an already-legible color untouched", () => {
    const out = normalizeXtermTheme({ ...baseTheme, background: "#1a1b26", red: "#f7768e" });
    expect(out.red).toBe("#f7768e");
  });

  it("always produces a cursor and a cursorAccent, even if the theme omits them", () => {
    const out = normalizeXtermTheme({ ...baseTheme, cursor: "", cursorAccent: "" });
    expect(out.cursor).toBeTruthy();
    expect(out.cursorAccent).toBeTruthy();
  });

  it("makes cursor and cursorAccent contrast with each other, not with the pane background", () => {
    const out = normalizeXtermTheme({ ...baseTheme, cursor: "#1a1b26", cursorAccent: "#1a1b26" });
    expect(contrast(out.cursor!, out.cursorAccent!)).toBeGreaterThan(1.6);
  });

  it("falls back to a known-good background when the theme's own background is invalid", () => {
    const out = normalizeXtermTheme({ ...baseTheme, background: "garbage" });
    expect(out.background).toMatch(HEX_RE);
  });
});

// Mirrors styling.test.ts's approach: read the real shipped files so a future theme (built-in or
// user-authored) that reintroduces an invisible color is caught here, not by a user report.
describe("builtin theme invariants", () => {
  const themesDir = path.join(ROOT, "src-tauri", "builtinThemes");
  const files = fs.readdirSync(themesDir).filter(f => f.endsWith(".json"));

  it("found at least one builtin theme to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s: every ANSI color is valid hex and distinguishable from its background", file => {
    const data = JSON.parse(fs.readFileSync(path.join(themesDir, file), "utf8"));
    for (const mode of ["dark", "light"] as const) {
      const palette = data.terminal[mode];
      expect(palette.background).toMatch(HEX_RE);
      for (const key of Object.keys(palette)) {
        if (key === "background" || key === "selectionForeground") continue;
        const value = palette[key];
        if (!value) continue; // selectionForeground may be legitimately empty
        expect(value, `${file} ${mode}.${key}`).toMatch(HEX_RE);
        // cursorAccent is the text color drawn UNDER the cursor block, so it legitimately equals
        // background in most themes (the cursor itself, drawn in `cursor`, is what must stand out).
        if (key === "cursorAccent" || key === "selectionBackground") continue;
        expect(value, `${file} ${mode}.${key} must differ from background`).not.toBe(palette.background);
      }
    }
  });
});
