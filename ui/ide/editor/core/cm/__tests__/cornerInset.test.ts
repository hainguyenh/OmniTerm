/** @vitest-environment jsdom */
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cornerInset } from "../cornerInset";

const views: EditorView[] = [];

function viewWith(wrapping: Compartment, on: boolean): EditorView {
  const view = new EditorView({
    doc: "x",
    extensions: [cornerInset, wrapping.of(on ? EditorView.lineWrapping : [])],
    parent: document.body,
  });
  views.push(view);
  const corner = document.createElement("div");
  corner.className = "cm-omniterm-corner";
  corner.getBoundingClientRect = () => ({ width: 100 }) as DOMRect;
  view.dom.appendChild(corner);
  Object.defineProperty(view.scrollDOM, "clientWidth", { value: 800 });
  view.dispatch({});
  return view;
}

describe("the corner inset", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  });
  afterEach(() => {
    views.splice(0).forEach((v) => v.destroy());
    vi.unstubAllGlobals();
  });

  it("reserves room at the end of lines that scroll sideways", () => {
    const view = viewWith(new Compartment(), false);
    expect(view.dom.style.getPropertyValue("--cm-corner-inset")).toBe("104px");
  });

  it("reserves nothing for soft-wrapped text, and follows the wrap toggle", () => {
    const wrapping = new Compartment();
    const view = viewWith(wrapping, true);
    expect(view.dom.style.getPropertyValue("--cm-corner-inset")).toBe("");
    view.dispatch({ effects: wrapping.reconfigure([]) });
    expect(view.dom.style.getPropertyValue("--cm-corner-inset")).toBe("104px");
    view.dispatch({ effects: wrapping.reconfigure(EditorView.lineWrapping) });
    expect(view.dom.style.getPropertyValue("--cm-corner-inset")).toBe("");
  });
});
