/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { mockOmnitermAPI } from "../../testUtils";
import RDPView from "../RDPView";
import OverlayBar from "../OverlayBar";
import SessionMetricsChips from "../SessionMetricsChips";

const rdpConnection = {
  id: "rdp-1",
  name: "RDP Test",
  type: "RDP" as const,
  host: "10.0.0.5",
  port: "3389",
  user: "admin",
};

describe("RDPView", () => {
  beforeEach(() => {
    mockOmnitermAPI();
    localStorage.clear();
    globalThis.ResizeObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    } as unknown as typeof ResizeObserver;
  });

  it("reports connected when rdp succeeds", async () => {
    const onStatus = vi.fn();
    render(<RDPView id="r1" connection={rdpConnection} active={false} overlayActive={false} onStatus={onStatus} />);
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith("connected"));
  });

  it("reports error when rdp fails", async () => {
    const onStatus = vi.fn();
    mockOmnitermAPI({
      connect: {
        rdp: async () => ({ ok: false, error: "auth failed" }),
      },
    });
    render(<RDPView id="r1" connection={rdpConnection} active={false} overlayActive={false} onStatus={onStatus} />);
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith("error"));
  });

  it("reports closed when user cancels connect prompt", async () => {
    const onStatus = vi.fn();
    mockOmnitermAPI({
      connect: {
        rdp: async () => ({ ok: false, error: "closed before connecting" }),
      },
    });
    render(<RDPView id="r1" connection={rdpConnection} active={false} overlayActive={false} onStatus={onStatus} />);
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith("closed"));
  });

  it("pushes bounds when the container has size", async () => {
    const setBounds = vi.fn();
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 300, height: 200, top: 0, left: 0, right: 300, bottom: 200, toJSON: () => {} }) as unknown as DOMRect;
    mockOmnitermAPI({
      connect: {
        rdp: async () => ({ ok: true }),
        rdpSetBounds: setBounds,
      },
    });
    try {
      render(<RDPView id="r1" connection={rdpConnection} active overlayActive={false} />);
      await waitFor(() => expect(setBounds).toHaveBeenCalled());
      const call = setBounds.mock.calls[0][1];
      expect(call.width).toBe(300);
      expect(call.height).toBe(200);
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
    }
  });
});

describe("OverlayBar", () => {
  beforeEach(() => {
    mockOmnitermAPI();
  });

  it("renders default remote session text", async () => {
    render(<OverlayBar />);
    await waitFor(() => expect(screen.getByText("Remote session")).toBeInTheDocument());
  });

  it("renders session name returned by overlayInit", async () => {
    mockOmnitermAPI({
      connect: {
        overlayInit: async () => ({ id: "s1", name: "Production DC" }),
      },
    });
    render(<OverlayBar />);
    await waitFor(() => expect(screen.getByText("Production DC")).toBeInTheDocument());
  });

  it("restore and disconnect buttons call IPC", async () => {
    const setDetached = vi.fn();
    const disconnect = vi.fn();
    mockOmnitermAPI({
      connect: {
        overlayInit: async () => ({ id: "s1", name: "Prod" }),
        rdpSetDetached: setDetached,
        rdpDisconnect: disconnect,
      },
    });
    render(<OverlayBar />);
    await waitFor(() => expect(screen.getByText("Prod")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /restore/i }));
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(setDetached).toHaveBeenCalledWith("s1", false);
    expect(disconnect).toHaveBeenCalledWith("s1");
  });
});

describe("SessionMetricsChips", () => {
  it("is empty when status is not connected", () => {
    const { container } = render(<SessionMetricsChips status="connecting" latency={null} metrics={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null latency as em dash", () => {
    render(<SessionMetricsChips status="connected" latency={null} metrics={undefined} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders compact latency without unit", () => {
    render(<SessionMetricsChips status="connected" latency={42} metrics={undefined} compact />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByText("42 ms")).not.toBeInTheDocument();
  });

  it("renders CPU, memory and disk chips when metrics provided", () => {
    render(<SessionMetricsChips status="connected" latency={120} metrics={{ latency: 120, cpu: 75, memUsed: 2 * 1024 ** 3, memTotal: 4 * 1024 ** 3, diskUsedPct: 85, ts: Date.now() }} />);
    expect(screen.getByText("120 ms")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("2.0/4.0 GB")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
  });
});
