/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { registerFontZoomSurface } from "@/workbench/contributions";
import { stepFontZoomAt, stepPaneFontSize } from "../EditorZoom";

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

describe("Ctrl+wheel font zoom by pointer region", () => {
  it("steps the terminal under the pointer, not another one in the same dock", () => {
    const dock = document.createElement("div");
    dock.setAttribute("data-font-zoom-region", "");
    dock.innerHTML = `<div id="left"><span id="cell"></span></div><div id="right"></div>`;
    const left = vi.fn();
    const right = vi.fn();
    const stops = [
      registerFontZoomSurface(dock.querySelector("#right")!, right),
      registerFontZoomSurface(dock.querySelector("#left")!, left),
    ];
    expect(stepFontZoomAt(dock.querySelector("#cell")!, -1)).toBe(true);
    expect(left).toHaveBeenCalledWith(-1);
    expect(right).not.toHaveBeenCalled();
    stops.forEach((stop) => stop());
  });

  it("steps what a region shows when the pointer is on its chrome, such as the tab strip", () => {
    const dock = document.createElement("div");
    dock.setAttribute("data-font-zoom-region", "");
    dock.innerHTML = `<div id="tabs"></div><div id="term"></div>`;
    const term = vi.fn();
    const stop = registerFontZoomSurface(dock.querySelector("#term")!, term);
    expect(stepFontZoomAt(dock.querySelector("#tabs")!, 1)).toBe(true);
    expect(term).toHaveBeenCalledWith(1);
    stop();
  });

  it("claims the wheel inside an editor pane even with nothing to zoom, so the app does not zoom", () => {
    const pane = document.createElement("section");
    pane.setAttribute("data-pane-id", "p1");
    pane.innerHTML = "<img alt=''>";
    expect(stepFontZoomAt(pane.querySelector("img")!, 1)).toBe(true);
  });

  it("leaves the wheel to the app zoom outside an editor pane or the terminal dock", () => {
    const sidebar = document.createElement("div");
    expect(stepFontZoomAt(sidebar, 1)).toBe(false);
  });
});
