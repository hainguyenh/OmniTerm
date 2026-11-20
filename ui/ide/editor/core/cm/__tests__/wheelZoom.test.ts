/** @vitest-environment jsdom */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { fontZoom, resetFontZoom, stepFontZoom, wheelZoom } from "../prefs";

function viewOf(): EditorView {
  return new EditorView({ state: EditorState.create({ doc: "x", extensions: [fontZoom, wheelZoom] }), parent: document.body });
}

function wheel(view: EditorView, init: WheelEventInit) {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  view.contentDOM.dispatchEvent(event);
  return event;
}

describe("Ctrl+wheel font zoom", () => {
  it("zooms only the editor under the pointer", () => {
    const hovered = viewOf();
    const other = viewOf();
    const event = wheel(hovered, { ctrlKey: true, deltaY: -1 });
    expect(event.defaultPrevented).toBe(true);
    expect(hovered.state.field(fontZoom)).toBe(1);
    expect(other.state.field(fontZoom)).toBe(0);
    wheel(hovered, { ctrlKey: true, deltaY: 1 });
    expect(hovered.state.field(fontZoom)).toBe(0);
    hovered.destroy();
    other.destroy();
  });

  it("leaves a plain wheel to scrolling", () => {
    const view = viewOf();
    expect(wheel(view, { deltaY: -1 }).defaultPrevented).toBe(false);
    expect(view.state.field(fontZoom)).toBe(0);
    view.destroy();
  });

  it("resets one editor without touching another", () => {
    const a = viewOf();
    const b = viewOf();
    stepFontZoom(a, 2);
    stepFontZoom(b, 3);
    resetFontZoom(a);
    expect(a.state.field(fontZoom)).toBe(0);
    expect(b.state.field(fontZoom)).toBe(3);
    a.destroy();
    b.destroy();
  });
});
