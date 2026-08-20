import { describe, it, expect } from "vitest";
import { FALLBACK_SHORTCUTS, resolveShortcuts, matchesChromeShortcut, survivesTerminalFocus } from "../utils/shortcuts";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
} as unknown as KeyboardEvent);

describe("resolveShortcuts", () => {
  it("falls back to defaults when nothing is saved", () => {
    expect(resolveShortcuts()).toEqual(FALLBACK_SHORTCUTS);
    expect(resolveShortcuts({})).toEqual(FALLBACK_SHORTCUTS);
  });

  it("fills a binding missing from a stale saved object", () => {
    // The backend's settings merge is shallow, so a settings file saved before a binding existed
    // has no key for it at all — resolution must not leave that binding unusable.
    const resolved = resolveShortcuts({ closeTab: "Ctrl+Shift+W" });
    expect(resolved.closeTab).toBe("Ctrl+Shift+W");
    expect(resolved.zoomIn).toBe(FALLBACK_SHORTCUTS.zoomIn);
  });

  it("provides shortcuts for the 5- and 7-pane layouts", () => {
    expect(FALLBACK_SHORTCUTS.layout5).toBe("Ctrl+5");
    expect(FALLBACK_SHORTCUTS.layout7).toBe("Ctrl+7");
    expect(resolveShortcuts({}).layout5).toBe("Ctrl+5");
    expect(resolveShortcuts({}).layout7).toBe("Ctrl+7");
  });
});

describe("survivesTerminalFocus", () => {
  it("lets the zoom trio through regardless of modifiers", () => {
    for (const key of ["zoomIn", "zoomOut", "zoomReset"] as const) {
      expect(survivesTerminalFocus(key, FALLBACK_SHORTCUTS[key])).toBe(true);
    }
  });

  it("blocks bare-Ctrl shell control keys", () => {
    expect(survivesTerminalFocus("closeTab", "Ctrl+W")).toBe(false);
    expect(survivesTerminalFocus("toggleSidebar", "Ctrl+B")).toBe(false);
    expect(survivesTerminalFocus("newSession", "Ctrl+N")).toBe(false);
    expect(survivesTerminalFocus("commandPalette", "CommandOrControl+P")).toBe(false);
    expect(survivesTerminalFocus("toggleThemeMode", "Ctrl+/")).toBe(false);
    expect(survivesTerminalFocus("openSettings", "Ctrl+,")).toBe(false);
  });

  it("lets any Ctrl+Shift or Ctrl+Alt combo through — it can't collide with a bare-Ctrl default", () => {
    expect(survivesTerminalFocus("newFolder", "Ctrl+Shift+N")).toBe(true);
    expect(survivesTerminalFocus("closeTab", "Ctrl+Alt+W")).toBe(true);
  });
});

describe("matchesChromeShortcut", () => {
  const s = FALLBACK_SHORTCUTS;

  it("matches ordinary chrome shortcuts outside a terminal", () => {
    expect(matchesChromeShortcut(key("w", { ctrlKey: true }), s, { inTerminal: false })).toBe(true);
  });

  // This is the actual bug report: Ctrl+W, Ctrl+B, Ctrl+N, Ctrl+P closed tabs / toggled the
  // sidebar / stole readline's history-prev instead of reaching the shell or agent underneath.
  it("no longer claims shell control keys when a terminal has focus", () => {
    for (const key_ of ["w", "b", "n", "p"]) {
      expect(matchesChromeShortcut(key(key_, { ctrlKey: true }), s, { inTerminal: true })).toBe(false);
    }
  });

  it("still claims the zoom trio inside a terminal", () => {
    expect(matchesChromeShortcut(key("=", { ctrlKey: true }), s, { inTerminal: true })).toBe(true);
    expect(matchesChromeShortcut(key("-", { ctrlKey: true }), s, { inTerminal: true })).toBe(true);
    expect(matchesChromeShortcut(key("0", { ctrlKey: true }), s, { inTerminal: true })).toBe(true);
  });

  it("still claims Ctrl+Shift+N inside a terminal", () => {
    expect(matchesChromeShortcut(key("N", { ctrlKey: true, shiftKey: true }), s, { inTerminal: true })).toBe(true);
  });

  it("matches nothing for an unrelated key", () => {
    expect(matchesChromeShortcut(key("q", { ctrlKey: true }), s, { inTerminal: false })).toBe(false);
  });
});
