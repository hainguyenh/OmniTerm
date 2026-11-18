/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { publishContext, setContext } = vi.hoisted(() => ({ publishContext: vi.fn(), setContext: vi.fn() }));

vi.mock("../../controller", async () => {
  const { create } = await import("zustand");
  return {
    useTabs: create(() => ({ activePane: "left", panes: { left: {}, right: {} } })),
    editorController: () => ({ publishContext }),
  };
});
vi.mock("@/platform/context", () => ({ setContext }));

import { useTabs } from "../../controller";
import { usePaneActivation } from "../paneActivation";

function Pane({ id }: { id: string }) {
  const [section, setSection] = useState<HTMLElement | null>(null);
  usePaneActivation(section, id);
  return <section ref={setSection} data-testid={id} />;
}

/** A node put into the pane by a DOM move, as a session's terminal is: outside its React tree. */
function movedInto(pane: HTMLElement): HTMLTextAreaElement {
  const host = document.createElement("div");
  const input = document.createElement("textarea");
  host.appendChild(input);
  pane.appendChild(host);
  return input;
}

beforeEach(() => {
  useTabs.setState({ activePane: "left" });
  publishContext.mockClear();
  setContext.mockClear();
});
afterEach(cleanup);

describe("selecting a split from inside it", () => {
  // Regression: clicking into the right split's agent terminal typed into it, but the left split
  // stayed selected until the right one's tab was clicked.
  it("selects the pane when focus lands in content moved into it", () => {
    const { getByTestId } = render(<Pane id="right" />);
    const input = movedInto(getByTestId("right"));

    act(() => input.focus());

    expect(useTabs.getState().activePane).toBe("right");
    expect(setContext).toHaveBeenCalledWith("editorFocus", true);
    expect(publishContext).toHaveBeenCalledOnce();
  });

  it("selects it on a press too, and does nothing for the pane already selected", () => {
    const { getByTestId } = render(
      <>
        <Pane id="left" />
        <Pane id="right" />
      </>,
    );
    const press = (id: string) =>
      act(() => {
        movedInto(getByTestId(id)).dispatchEvent(new Event("pointerdown", { bubbles: true }));
      });

    press("left");
    expect(publishContext).not.toHaveBeenCalled();
    press("right");
    expect(useTabs.getState().activePane).toBe("right");
  });

  it("ignores a pane that has gone", () => {
    const { getByTestId } = render(<Pane id="closed" />);
    act(() => movedInto(getByTestId("closed")).focus());
    expect(useTabs.getState().activePane).toBe("left");
  });
});
