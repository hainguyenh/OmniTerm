/** @vitest-environment jsdom */
/**
 * Busy/idle signalling and cross-restart scrollback — the two stream behaviours the session
 * status indicators and the restart-restore feature depend on. Split from terminalStream.test.ts
 * to keep both files under the source-size limit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { deleteScrollback, loadScrollback, saveScrollback } from "../utils/scrollbackStore";
import { mockOmnitermAPI } from "../testUtils";
import { attach, bytes, written } from "./terminalStreamHarness";

/** Captured onLocalActivity callback, so a test can drive backend busy/idle transitions. */
let localActivitySink: ((busy: boolean) => void) | undefined;

beforeEach(() => {
  mockOmnitermAPI();
});

describe("attachTerminalStream — activity and scrollback", () => {
  it("marks stream busy on incoming data and settles to idle after debounce interval", () => {
    vi.useFakeTimers();
    try {
      const { fire, onActivity } = attach({ isLocal: true });

      fire.data?.(bytes("hello world"));
      expect(onActivity).toHaveBeenCalledWith(true);

      vi.advanceTimersByTime(1300);
      expect(onActivity).toHaveBeenCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the busy debounce immediately when the stream errors", () => {
    vi.useFakeTimers();
    try {
      const { fire, onActivity } = attach({ isLocal: true });

      fire.data?.(bytes("partial output"));
      expect(onActivity).toHaveBeenCalledWith(true);

      fire.error?.("boom");
      expect(onActivity).toHaveBeenCalledWith(false);
      let idleCalls = onActivity.mock.calls.filter(([busy]) => busy === false).length;
      expect(idleCalls).toBe(1);

      // The cleared timer must not fire a second idle transition later.
      vi.advanceTimersByTime(2000);
      idleCalls = onActivity.mock.calls.filter(([busy]) => busy === false).length;
      expect(idleCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the busy debounce when the session exits", () => {
    vi.useFakeTimers();
    try {
      const { fire, onActivity } = attach({ isLocal: true });

      fire.data?.(bytes("last words"));
      fire.closed?.(0);

      expect(onActivity).toHaveBeenCalledWith(false);
      vi.advanceTimersByTime(2000);
      expect(onActivity.mock.calls.filter(([busy]) => busy === false).length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps busy when the backend reports idle while output is still arriving", () => {
    vi.useFakeTimers();
    try {
      const onLocalActivity = vi.fn((_id: string, cb: (busy: boolean) => void) => {
        localActivitySink = cb;
        return () => {};
      });
      mockOmnitermAPI({ connect: { onLocalActivity } });
      const { fire, onActivity } = attach({ isLocal: true });

      fire.data?.(bytes("burst"));
      localActivitySink?.(false);

      // The pending output debounce outranks the backend's idle report.
      expect(onActivity.mock.calls.filter(([busy]) => busy === false).length).toBe(0);

      vi.advanceTimersByTime(1300);
      expect(onActivity).toHaveBeenCalledWith(false);
    } finally {
      localActivitySink = undefined;
      vi.useRealTimers();
    }
  });

  it("re-arms the debounce so a steady stream never flickers to idle", () => {
    vi.useFakeTimers();
    try {
      const { fire, onActivity } = attach({ isLocal: true });

      fire.data?.(bytes("tick"));
      vi.advanceTimersByTime(800);
      fire.data?.(bytes("tock"));
      vi.advanceTimersByTime(800);
      fire.data?.(bytes("tick"));
      vi.advanceTimersByTime(800);

      expect(onActivity.mock.calls.filter(([busy]) => busy === false).length).toBe(0);

      vi.advanceTimersByTime(500);
      expect(onActivity).toHaveBeenCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("paints saved scrollback before live output and saves the merged buffer on dispose", async () => {
    await saveScrollback("sb-pane-1", "saved history\r\n");
    const { term, fire, stream } = attach({
      scrollbackKey: "sb-pane-1",
      smartColors: () => false,
    });

    // Live bytes arrive before the store read resolves — they must queue behind it.
    fire.data?.(bytes("live output\r\n"));
    await vi.waitFor(() => expect(written(term)).toContain("live output"));

    expect(written(term)).toBe("saved history\r\nlive output\r\n");
    // The debounce has not elapsed, so the store still holds only the previous save.
    expect(await loadScrollback("sb-pane-1")).toBe("saved history\r\n");

    stream.dispose();
    await vi.waitFor(async () => {
      expect(await loadScrollback("sb-pane-1")).toBe("saved history\r\nlive output\r\n");
    });
    await deleteScrollback("sb-pane-1");
  });
});
