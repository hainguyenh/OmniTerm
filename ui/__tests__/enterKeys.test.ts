import { describe, it, expect } from "vitest";
import {
  enterSequenceFor,
  resolveEnterModes,
  DEFAULT_ENTER_MODES,
  ESC_CR,
  LF,
} from "../utils/enterKeys";

const key = (code: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("enterSequenceFor", () => {
  it("sends ESC+CR for Shift+Enter by default", () => {
    expect(enterSequenceFor(key("Enter", { shiftKey: true }), DEFAULT_ENTER_MODES)).toBe(ESC_CR);
  });

  it("sends a literal newline for Ctrl+Enter by default", () => {
    expect(enterSequenceFor(key("Enter", { ctrlKey: true }), DEFAULT_ENTER_MODES)).toBe(LF);
  });

  it("treats NumpadEnter the same as Enter", () => {
    expect(enterSequenceFor(key("NumpadEnter", { shiftKey: true }), DEFAULT_ENTER_MODES)).toBe(ESC_CR);
  });

  it("honours the configured mode, including 'off'", () => {
    expect(enterSequenceFor(key("Enter", { shiftKey: true }), { shiftEnter: "lf", ctrlEnter: "off" })).toBe(LF);
    expect(enterSequenceFor(key("Enter", { ctrlKey: true }), { shiftEnter: "lf", ctrlEnter: "off" })).toBeNull();
  });

  it("lets Shift win over Ctrl when both are held", () => {
    expect(enterSequenceFor(key("Enter", { shiftKey: true, ctrlKey: true }), DEFAULT_ENTER_MODES)).toBe(ESC_CR);
  });

  // xterm already emits ESC+CR for Alt+Enter, and bails on ctrl+alt as AltGr — leave both alone.
  it("falls through for plain Enter, Alt+Enter and Ctrl+Alt+Enter", () => {
    expect(enterSequenceFor(key("Enter"), DEFAULT_ENTER_MODES)).toBeNull();
    expect(enterSequenceFor(key("Enter", { altKey: true }), DEFAULT_ENTER_MODES)).toBeNull();
    expect(enterSequenceFor(key("Enter", { ctrlKey: true, altKey: true }), DEFAULT_ENTER_MODES)).toBeNull();
  });

  it("ignores keys that are not Enter", () => {
    expect(enterSequenceFor(key("KeyA", { shiftKey: true }), DEFAULT_ENTER_MODES)).toBeNull();
  });
});

describe("resolveEnterModes", () => {
  it("falls back to the defaults when the keys are absent", () => {
    expect(resolveEnterModes({})).toEqual(DEFAULT_ENTER_MODES);
  });

  it("uses stored values when they are valid modes", () => {
    expect(resolveEnterModes({ shiftEnter: "off", ctrlEnter: "esc-cr" })).toEqual({
      shiftEnter: "off",
      ctrlEnter: "esc-cr",
    });
  });

  // A hand-edited settings file must not be able to silently disable the key.
  it("rejects values that are not one of the three modes", () => {
    expect(resolveEnterModes({ shiftEnter: "newline", ctrlEnter: "" })).toEqual(DEFAULT_ENTER_MODES);
  });
});
