import { describe, expect, it } from "vitest";

import { clampDialogOffset } from "../dialogBounds";

const viewport = { width: 1000, height: 800 };
// A 600x400 dialog centred in the window.
const box = { left: 200, top: 200, width: 600, height: 400 };

describe("clampDialogOffset", () => {
  it("keeps an offset that leaves the dialog inside the window", () => {
    const offset = { x: 50, y: -100 };
    expect(clampDialogOffset(offset, box, viewport)).toBe(offset);
  });

  it("stops the dialog at every edge of the window", () => {
    expect(clampDialogOffset({ x: 900, y: 900 }, box, viewport)).toEqual({ x: 200, y: 200 });
    expect(clampDialogOffset({ x: -900, y: -900 }, box, viewport)).toEqual({ x: -200, y: -200 });
  });

  it("keeps the dialog below an overlay title bar", () => {
    expect(clampDialogOffset({ x: 0, y: -900 }, box, viewport, 40)).toEqual({ x: 0, y: -160 });
  });

  it("keeps the top-left corner of a dialog larger than the window visible", () => {
    const large = { left: -100, top: -50, width: 1200, height: 900 };
    expect(clampDialogOffset({ x: 300, y: 300 }, large, viewport)).toEqual({ x: 100, y: 50 });
    expect(clampDialogOffset({ x: -300, y: -300 }, large, viewport)).toEqual({ x: 100, y: 50 });
  });
});
