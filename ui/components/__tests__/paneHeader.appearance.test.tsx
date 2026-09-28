/**
 * @vitest-environment jsdom
 *
 * The per-pane theme + font-size control (AppearanceMenu) on a pane (dock) header.
 *
 * Before it existed, restyling a split-view pane meant focusing it first and using the TitleBar —
 * the one control that changes the FOCUSED terminal. These assertions cover that a pane can now
 * change its own look without ever being the focused one, and that opening the palette does not
 * fight the header's other controls (the session picker, the drag handle).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import PaneHeader from "../PaneHeader";
import { TOKYO_NIGHT } from "../../themes";
import type { Connection } from "@omniterm/contract";

const conn = { id: "c1", name: "Web Server", type: "SSH", host: "10.0.0.1", port: "22", user: "root" } as Connection;

function renderHeader(props: Partial<React.ComponentProps<typeof PaneHeader>> = {}) {
  const onFocus = vi.fn();
  const onTogglePicker = vi.fn();
  const onThemeApply = vi.fn();
  const onFontSizeChange = vi.fn();
  render(
    <PaneHeader
      paneIndex={1}
      conn={conn}
      focused={false}
      sessionId="s1"
      tabs={[{ id: "s1", connId: "c1", name: "Web Server" }]}
      panes={[null, "s1"]}
      layoutMode={2}
      statuses={{ s1: "connected" }}
      connType={() => "SSH"}
      pickerOpen={false}
      pickerRef={createRef<HTMLDivElement>()}
      detach={null}
      onToggleDetach={vi.fn()}
      onFocus={onFocus}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onTogglePicker={onTogglePicker}
      onAssign={vi.fn()}
      onClear={vi.fn()}
      appearance={{
        themes: [TOKYO_NIGHT],
        themeId: TOKYO_NIGHT.id,
        fontSize: 16,
        darkMode: true,
        onThemeApply,
        onFontSizeChange,
      }}
      {...props}
    />,
  );
  return { onFocus, onTogglePicker, onThemeApply, onFontSizeChange };
}

describe("pane header appearance control", () => {
  it("is omitted for an empty pane (no appearance to change)", () => {
    renderHeader({ appearance: undefined });
    expect(screen.queryByRole("button", { name: /Appearance/i })).not.toBeInTheDocument();
  });

  it("shows this pane's theme control, labelled by pane number", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: "Appearance — theme & font size (Pane 2)" })).toBeInTheDocument();
  });

  it("does not expose footer font controls in the header", () => {
    const { onFontSizeChange } = renderHeader();
    expect(screen.queryByRole("button", { name: "+" })).not.toBeInTheDocument();
    expect(onFontSizeChange).not.toHaveBeenCalled();
  });

  it("applies a theme to just this pane via its own palette", () => {
    const { onThemeApply } = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Appearance — theme & font size (Pane 2)" }));
    fireEvent.click(screen.getByText("Tokyo Night"));
    expect(onThemeApply).toHaveBeenCalledWith("tokyo-night");
  });

  it("does not open the session picker when the appearance control is used", () => {
    const { onTogglePicker } = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Appearance — theme & font size (Pane 2)" }));
    expect(onTogglePicker).not.toHaveBeenCalled();
  });

  it("opens the session picker upward when the trigger is near the bottom edge", () => {
    renderHeader({
      pickerOpen: true,
      pickerAnchor: { left: 100, top: 700, bottom: 724 } as DOMRect,
    });

    const picker = screen.getByText("Empty this pane").parentElement as HTMLElement;
    expect(picker).toHaveStyle({ bottom: "72px", maxHeight: "260px" });
    expect(picker.style.top).toBe("");
    expect(picker).toHaveClass("overflow-y-auto");
  });
});
