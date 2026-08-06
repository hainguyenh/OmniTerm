import { describe, it, expect } from "vitest";
import { clipboardActionFor, normalizePastePayload } from "../utils/paste";

const key = (code: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("clipboardActionFor", () => {
  it("claims Ctrl+V on Windows/Linux", () => {
    expect(clipboardActionFor(key("KeyV", { ctrlKey: true }), false)).toBe("paste");
  });

  // On macOS xterm produces no key for Cmd+V, so it never cancels the event and its own native
  // paste listener is already the only writer. Claiming it here would just add a way to double-fire.
  it("leaves Cmd+V to xterm's native paste on macOS", () => {
    expect(clipboardActionFor(key("KeyV", { metaKey: true }), true)).toBeNull();
    expect(clipboardActionFor(key("KeyV", { ctrlKey: true }), true)).toBeNull();
  });

  it("claims Ctrl+Shift+V on every platform", () => {
    expect(clipboardActionFor(key("KeyV", { ctrlKey: true, shiftKey: true }), false)).toBe("paste");
    expect(clipboardActionFor(key("KeyV", { ctrlKey: true, shiftKey: true }), true)).toBe("paste");
  });

  it("claims Ctrl+Shift+C for copy but never plain Ctrl+C", () => {
    expect(clipboardActionFor(key("KeyC", { ctrlKey: true, shiftKey: true }), false)).toBe("copy");
    // Plain Ctrl+C must stay SIGINT.
    expect(clipboardActionFor(key("KeyC", { ctrlKey: true }), false)).toBeNull();
  });

  it("ignores combos that include Alt", () => {
    expect(clipboardActionFor(key("KeyV", { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(clipboardActionFor(key("KeyC", { ctrlKey: true, shiftKey: true, altKey: true }), false)).toBeNull();
  });

  it("ignores unrelated keys and unmodified V", () => {
    expect(clipboardActionFor(key("KeyV"), false)).toBeNull();
    expect(clipboardActionFor(key("KeyB", { ctrlKey: true }), false)).toBeNull();
  });
});

describe("normalizePastePayload", () => {
  // Sending CRLF verbatim is what made a multi-line paste execute its lines as commands.
  it("collapses CRLF and lone LF to CR", () => {
    expect(normalizePastePayload("a\r\nb\nc", false)).toBe("a\rb\rc");
  });

  it("wraps in bracketed-paste markers when the mode is on", () => {
    expect(normalizePastePayload("hi", true)).toBe("\x1b[200~hi\x1b[201~");
  });

  it("omits the markers when the mode is off", () => {
    expect(normalizePastePayload("hi", false)).toBe("hi");
  });

  it("normalizes before bracketing, so the markers bracket the whole payload", () => {
    expect(normalizePastePayload("a\r\nb", true)).toBe("\x1b[200~a\rb\x1b[201~");
  });

  it("passes text with no line breaks through untouched", () => {
    expect(normalizePastePayload("plain text", false)).toBe("plain text");
  });
});
