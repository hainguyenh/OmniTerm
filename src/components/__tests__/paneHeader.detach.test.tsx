/**
 * @vitest-environment jsdom
 *
 * The detach/attach button on a pane (dock) header.
 *
 * Before it existed, moving a session between the main window and its own window meant going through
 * the footer, which only ever acts on the ACTIVE tab — so a session sitting in another pane had to be
 * clicked into focus first. These assertions cover the part detachControl.test.ts cannot: that each
 * dock actually renders its own control, that it points the right way, and that it does not disturb
 * the pane chrome it shares a corner with.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import PaneHeader from "../PaneHeader";
import type { Connection } from "@omniterm/contract";

const conn = { id: "c1", name: "Web Server", type: "SSH", host: "10.0.0.1", port: "22", user: "root" } as Connection;

function renderHeader(props: Partial<React.ComponentProps<typeof PaneHeader>> = {}) {
  const onToggleDetach = vi.fn();
  const onTogglePicker = vi.fn();
  render(
    <PaneHeader
      paneIndex={0}
      conn={conn}
      focused
      sessionId="s1"
      tabs={[{ id: "s1", connId: "c1", name: "Web Server" }]}
      panes={["s1", null]}
      layoutMode={2}
      statuses={{ s1: "connected" }}
      connType={() => "SSH"}
      pickerOpen={false}
      pickerRef={createRef<HTMLDivElement>()}
      detach="detach"
      onToggleDetach={onToggleDetach}
      onFocus={vi.fn()}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onTogglePicker={onTogglePicker}
      onAssign={vi.fn()}
      onClear={vi.fn()}
      {...props}
    />,
  );
  return { onToggleDetach, onTogglePicker };
}

describe("pane header detach control", () => {
  it("offers to detach a docked session, and fires for that pane", () => {
    const { onToggleDetach } = renderHeader();
    const button = screen.getByRole("button", { name: /detach this pane/i });
    fireEvent.click(button);
    expect(onToggleDetach).toHaveBeenCalledTimes(1);
  });

  it("flips to attach once the session is out in its own window", () => {
    const { onToggleDetach } = renderHeader({ detach: "attach" });
    expect(screen.queryByRole("button", { name: /detach this pane/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /attach back/i }));
    expect(onToggleDetach).toHaveBeenCalledTimes(1);
  });

  it("omits the control entirely when the session cannot move", () => {
    renderHeader({ detach: null });
    expect(screen.queryByRole("button", { name: /detach|attach/i })).toBeNull();
    // The session picker must survive — the two buttons share the header's right corner.
    expect(screen.getByTitle("Choose session for this pane")).toBeInTheDocument();
  });

  it("does not open the session picker or steal focus when detaching", () => {
    // Both buttons sit inside the header's own mousedown/click handlers, so each has to stop
    // propagation or clicking detach would also re-focus the pane and toggle the picker.
    const { onToggleDetach, onTogglePicker } = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: /detach this pane/i }));
    expect(onToggleDetach).toHaveBeenCalledTimes(1);
    expect(onTogglePicker).not.toHaveBeenCalled();
  });

  it("still shows the pane's identity and session name beside the control", () => {
    renderHeader();
    expect(screen.getByText("Web Server")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /detach this pane/i })).toBeInTheDocument();
  });
});
