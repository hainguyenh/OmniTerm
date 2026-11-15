/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { registerFontZoomSurface } from "@/workbench/contributions";
import { stepPaneFontSize } from "../EditorZoom";

describe("the pane font size controls", () => {
  it("step the terminal shown in the pane, not one of a hidden kept-alive tab", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div aria-hidden="true"><div id="hidden"></div></div><div><div id="shown"></div></div>`;
    const hidden = vi.fn();
    const shown = vi.fn();
    const stops = [
      registerFontZoomSurface(root.querySelector("#hidden")!, hidden),
      registerFontZoomSurface(root.querySelector("#shown")!, shown),
    ];
    expect(stepPaneFontSize(root, 1)).toBe(true);
    expect(shown).toHaveBeenCalledWith(1);
    expect(hidden).not.toHaveBeenCalled();
    stops.forEach((stop) => stop());
  });

  it("do nothing in a pane without a zoomable editor", () => {
    const root = document.createElement("div");
    root.innerHTML = "<img alt=''>";
    expect(stepPaneFontSize(root, 1)).toBe(false);
  });
});
