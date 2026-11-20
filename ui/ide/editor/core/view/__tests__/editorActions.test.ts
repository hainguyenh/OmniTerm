/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { shownCorner } from "../EditorActions";

describe("the editor actions' corner", () => {
  it("is the shown editor's, never one of a hidden kept-alive tab", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div aria-hidden="true"><div class="cm-editor"><div class="cm-omniterm-corner" id="hidden"></div></div></div>
      <div><div class="cm-editor"><div class="cm-omniterm-corner" id="shown"></div></div></div>`;
    expect(shownCorner(root)?.id).toBe("shown");
  });

  it("is missing for an editor kind without one", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div aria-hidden="true"><div class="cm-omniterm-corner"></div></div><img alt="">`;
    expect(shownCorner(root)).toBeNull();
  });
});
