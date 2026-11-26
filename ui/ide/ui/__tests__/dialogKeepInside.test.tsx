/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "../Dialog";

const RECT = { left: 200, top: 200, width: 600, height: 400 };

/** The dialog's rect: where it sits centred, moved by its current `translate`. */
function mockRect(dialog: HTMLElement) {
  vi.spyOn(dialog, "getBoundingClientRect").mockImplementation(() => {
    const [x = 0, y = 0] = (dialog.style.translate || "0px 0px").split(" ").map((part) => parseFloat(part));
    const left = RECT.left + x;
    const top = RECT.top + y;
    return { ...RECT, left, top, x: left, y: top, right: left + RECT.width, bottom: top + RECT.height, toJSON: () => ({}) };
  });
}

function drag(dialog: HTMLElement, to: { x: number; y: number }) {
  const handle = dialog.querySelector<HTMLElement>("[data-dialog-titlebar]")!;
  fireEvent.pointerDown(handle, { button: 0, buttons: 1, clientX: 300, clientY: 210 });
  fireEvent.pointerMove(window, { buttons: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(window);
}

describe("Dialog keepInside", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cannot be dragged out of the window", () => {
    render(
      <Dialog open onClose={() => undefined} title="Inside" keepInside platform="other">
        body
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    mockRect(dialog);
    Object.assign(window, { innerWidth: 1000, innerHeight: 800 });
    drag(dialog, { x: 3000, y: 3000 });
    expect(dialog.style.translate).toBe("200px 200px");
    drag(dialog, { x: -3000, y: -3000 });
    expect(dialog.style.translate).toBe("-200px -200px");
  });

  it("is pulled back inside when the window shrinks", () => {
    render(
      <Dialog open onClose={() => undefined} title="Inside" keepInside platform="other">
        body
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    mockRect(dialog);
    Object.assign(window, { innerWidth: 1000, innerHeight: 800 });
    drag(dialog, { x: 3000, y: 3000 });
    Object.assign(window, { innerWidth: 900, innerHeight: 700 });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(dialog.style.translate).toBe("100px 100px");
  });
});
