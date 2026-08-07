/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { mockOmnitermAPI } from "../../testUtils";
import ConfirmDialog from "../ConfirmDialog";

describe("ConfirmDialog", () => {
  beforeEach(() => {
    mockOmnitermAPI();
  });

  it("renders default labels", () => {
    render(<ConfirmDialog title="Delete?" message="This will remove the connection." onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Delete?")).toBeInTheDocument();
    expect(screen.getByText("This will remove the connection.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep editing" })).toBeInTheDocument();
  });

  it("renders custom confirm and cancel labels", () => {
    render(<ConfirmDialog title="Delete?" message="Remove?" confirmLabel="Yes, delete" cancelLabel="No" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Yes, delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument();
  });

  it("calls onConfirm when confirm clicked", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog title="Delete?" message="Remove?" onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when cancel clicked", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Delete?" message="Remove?" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Escape pressed", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Delete?" message="Remove?" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when backdrop clicked", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Delete?" message="Remove?" onConfirm={vi.fn()} onCancel={onCancel} />);
    const backdrop = document.querySelector(".fixed.inset-0")!;
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onCancel when panel is clicked", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Delete?" message="Remove?" onConfirm={vi.fn()} onCancel={onCancel} />);
    const panel = document.querySelector(".bg-theme-popup")!;
    fireEvent.click(panel);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancel button has autoFocus attribute", () => {
    render(<ConfirmDialog title="Delete?" message="Remove?" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const cancelBtn = screen.getByRole("button", { name: "Keep editing" });
    expect(cancelBtn).toHaveFocus();
  });
});

// ── DialogHost ────────────────────────────────────────────────────────────────

import DialogHost from "../DialogHost";
import type { DialogTone } from "../../hooks/useDialog";

// ── Typed state builders ───────────────────────────────────────────────────────

type AlertState = {
  kind: "alert"; title: string; message: string; tone: DialogTone;
  buttonLabel: string; resolve: () => void;
};
type ConfirmState = {
  kind: "confirm"; title: string; message: string; tone: DialogTone;
  confirmLabel: string; cancelLabel: string; resolve: (v: boolean) => void;
};

function makeAlertState(overrides: Partial<Omit<AlertState, "kind" | "resolve">> & { resolve?: () => void } = {}): AlertState {
  return {
    kind: "alert",
    title: overrides.title ?? "Test Alert",
    message: overrides.message ?? "This is a test alert.",
    tone: overrides.tone ?? "info",
    buttonLabel: overrides.buttonLabel ?? "OK",
    resolve: overrides.resolve ?? vi.fn(),
  };
}

function makeConfirmState(overrides: Partial<Omit<ConfirmState, "kind" | "resolve">> & { resolve?: (v: boolean) => void } = {}): ConfirmState {
  return {
    kind: "confirm",
    title: overrides.title ?? "Test Confirm",
    message: overrides.message ?? "Are you sure?",
    tone: overrides.tone ?? "warning",
    confirmLabel: overrides.confirmLabel ?? "Yes",
    cancelLabel: overrides.cancelLabel ?? "No",
    resolve: overrides.resolve ?? vi.fn(),
  };
}

describe("DialogHost", () => {
  beforeEach(() => { mockOmnitermAPI(); });

  it("renders nothing when dialogState is null", () => {
    const { container } = render(<DialogHost dialogState={null} />);
    expect(container.firstChild).toBeNull();
  });

  // ── Alert variant ──────────────────────────────────────────────────────────

  describe("alert dialog", () => {
    it("renders title and message", () => {
      render(<DialogHost dialogState={makeAlertState()} />);
      expect(screen.getByText("Test Alert")).toBeInTheDocument();
      expect(screen.getByText("This is a test alert.")).toBeInTheDocument();
    });

    it("renders the OK button", () => {
      render(<DialogHost dialogState={makeAlertState()} />);
      expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
    });

    it("renders a custom buttonLabel", () => {
      render(<DialogHost dialogState={makeAlertState({ buttonLabel: "Got it" })} />);
      expect(screen.getByRole("button", { name: "Got it" })).toBeInTheDocument();
    });

    it("calls resolve when OK clicked", () => {
      const resolve = vi.fn();
      render(<DialogHost dialogState={makeAlertState({ resolve })} />);
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
      expect(resolve).toHaveBeenCalledTimes(1);
    });

    it("calls resolve when Escape pressed", () => {
      const resolve = vi.fn();
      render(<DialogHost dialogState={makeAlertState({ resolve })} />);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(resolve).toHaveBeenCalledTimes(1);
    });

    it("calls resolve when Enter pressed", () => {
      const resolve = vi.fn();
      render(<DialogHost dialogState={makeAlertState({ resolve })} />);
      fireEvent.keyDown(document, { key: "Enter" });
      expect(resolve).toHaveBeenCalledTimes(1);
    });

    it("calls resolve when backdrop clicked", () => {
      const resolve = vi.fn();
      render(<DialogHost dialogState={makeAlertState({ resolve })} />);
      const backdrop = document.querySelector(".nc-dialog-backdrop")!;
      fireEvent.click(backdrop);
      expect(resolve).toHaveBeenCalledTimes(1);
    });

    it("does NOT call resolve when dialog panel is clicked (not backdrop)", () => {
      const resolve = vi.fn();
      render(<DialogHost dialogState={makeAlertState({ resolve })} />);
      const panel = document.querySelector(".nc-dialog-panel")!;
      fireEvent.click(panel);
      expect(resolve).not.toHaveBeenCalled();
    });

    it.each([
      ["info",    "Info"],
      ["warning", "Warning Alert"],
      ["error",   "Error Alert"],
      ["success", "Success Alert"],
    ] as const)("renders %s tone with the correct title", (tone, title) => {
      render(<DialogHost dialogState={makeAlertState({ tone, title })} />);
      expect(screen.getByText(title)).toBeInTheDocument();
    });

    it("renders the accent bar element", () => {
      render(<DialogHost dialogState={makeAlertState()} />);
      expect(document.querySelector(".nc-dialog-accent-bar")).toBeTruthy();
    });

    it("has role=dialog on the panel", () => {
      render(<DialogHost dialogState={makeAlertState()} />);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("has aria-modal=true on the panel", () => {
      render(<DialogHost dialogState={makeAlertState()} />);
      expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    });
  });

  // ── Confirm variant ────────────────────────────────────────────────────────

  describe("confirm dialog", () => {
    it("renders title and message", () => {
      render(<DialogHost dialogState={makeConfirmState()} />);
      expect(screen.getByText("Test Confirm")).toBeInTheDocument();
      expect(screen.getByText("Are you sure?")).toBeInTheDocument();
    });

    it("renders confirm and cancel buttons", () => {
      render(<DialogHost dialogState={makeConfirmState()} />);
      expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument();
    });

    it("calls resolve(true) when confirm clicked", () => {
      const resolve = vi.fn();
      render(<DialogHost dialogState={makeConfirmState({ resolve })} />);
      fireEvent.click(screen.getByRole("button", { name: "Yes" }));
      expect(resolve).toHaveBeenCalledWith(true);
    });

    it("calls resolve(false) when cancel clicked", () => {
      const resolve = vi.fn();
      render(<DialogHost dialogState={makeConfirmState({ resolve })} />);
      fireEvent.click(screen.getByRole("button", { name: "No" }));
      expect(resolve).toHaveBeenCalledWith(false);
    });

    it("calls resolve(false) when Escape pressed", () => {
      const resolve = vi.fn();
      render(<DialogHost dialogState={makeConfirmState({ resolve })} />);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(resolve).toHaveBeenCalledWith(false);
    });

    it("calls resolve(true) when Enter pressed", () => {
      const resolve = vi.fn();
      render(<DialogHost dialogState={makeConfirmState({ resolve })} />);
      fireEvent.keyDown(document, { key: "Enter" });
      expect(resolve).toHaveBeenCalledWith(true);
    });

    it("calls resolve(false) when backdrop clicked", () => {
      const resolve = vi.fn();
      render(<DialogHost dialogState={makeConfirmState({ resolve })} />);
      const backdrop = document.querySelector(".nc-dialog-backdrop")!;
      fireEvent.click(backdrop);
      expect(resolve).toHaveBeenCalledWith(false);
    });

    it("does NOT call resolve when dialog panel is clicked (not backdrop)", () => {
      const resolve = vi.fn();
      render(<DialogHost dialogState={makeConfirmState({ resolve })} />);
      const panel = document.querySelector(".nc-dialog-panel")!;
      fireEvent.click(panel);
      expect(resolve).not.toHaveBeenCalled();
    });

    it("renders custom confirmLabel and cancelLabel", () => {
      render(<DialogHost dialogState={makeConfirmState({ confirmLabel: "Delete", cancelLabel: "Keep" })} />);
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
    });

    it("has role=dialog and aria-modal=true", () => {
      render(<DialogHost dialogState={makeConfirmState()} />);
      expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    });
  });
});

