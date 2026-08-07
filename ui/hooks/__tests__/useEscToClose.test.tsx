/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEscToClose } from "../useEscToClose";

describe("useEscToClose", () => {
  it("calls onClose when Escape is pressed and not dirty", () => {
    const onClose = vi.fn();
    const onGuard = vi.fn();
    renderHook(() => useEscToClose(false, onClose, onGuard));
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onClose).toHaveBeenCalled();
    expect(onGuard).not.toHaveBeenCalled();
  });

  it("calls onGuard when Escape is pressed and dirty", () => {
    const onClose = vi.fn();
    const onGuard = vi.fn();
    renderHook(() => useEscToClose(true, onClose, onGuard));
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onGuard).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const onClose = vi.fn();
    const onGuard = vi.fn();
    renderHook(() => useEscToClose(false, onClose, onGuard, false));
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(onGuard).not.toHaveBeenCalled();
  });
});
