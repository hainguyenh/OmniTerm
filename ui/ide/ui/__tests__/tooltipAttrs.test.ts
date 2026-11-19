import { describe, expect, it } from "vitest";

import { tooltipAttrs } from "../Tooltip";

describe("tooltipAttrs", () => {
  it("gives text and its shortcut as attributes", () => {
    expect(tooltipAttrs("Run", "Ctrl+R", true)).toEqual({
      "data-tooltip": "Run",
      "data-tooltip-shortcut": "Ctrl+R",
      "data-tooltip-verbatim": "",
    });
  });

  it("never puts a value that is not text on the element", () => {
    // React rejects `data-tooltip={true}` at render (the launch warning this guards against).
    for (const value of [true, false, 1, {}, () => "x", null, undefined, ""]) {
      expect(tooltipAttrs(value)).toEqual({});
    }
    expect(tooltipAttrs("Save", true)).toEqual({ "data-tooltip": "Save" });
  });
});
