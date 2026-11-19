/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Popup } from "../Popup";

function renderPopup(draggable: boolean) {
  render(
    <Popup open onClose={() => undefined} anchor={{ x: 100, y: 100 }} draggable={draggable} aria-label="Chooser">
      <div data-popup-drag="" data-testid="handle">
        Header
      </div>
      <button type="button">Body</button>
    </Popup>,
  );
  const popup = screen.getByRole("dialog");
  vi.spyOn(popup, "getBoundingClientRect").mockImplementation(() => {
    const [x = 0, y = 0] = (popup.style.translate || "0px 0px").split(" ").map((part) => parseFloat(part));
    const left = 100 + x;
    const top = 100 + y;
    return { left, top, x: left, y: top, width: 300, height: 200, right: left + 300, bottom: top + 200, toJSON: () => ({}) };
  });
  return popup;
}

function dragBy(to: { x: number; y: number }) {
  fireEvent.pointerDown(screen.getByTestId("handle"), { button: 0, buttons: 1, clientX: 120, clientY: 110 });
  fireEvent.pointerMove(window, { buttons: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(window);
}

describe("Popup draggable", () => {
  afterEach(() => vi.restoreAllMocks());

  it("moves by its handle", () => {
    const popup = renderPopup(true);
    dragBy({ x: 170, y: 160 });
    expect(popup.style.translate).toBe("50px 50px");
  });

  it("stays inside the window", () => {
    const popup = renderPopup(true);
    dragBy({ x: -5000, y: -5000 });
    expect(popup.style.translate).toBe("-100px -100px");
  });

  it("does not move unless draggable", () => {
    const popup = renderPopup(false);
    dragBy({ x: 170, y: 160 });
    expect(popup.style.translate).toBe("");
  });
});
