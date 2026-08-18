/** @vitest-environment jsdom */
/**
 * Busy/idle signalling and cross-restart scrollback — the two stream behaviours the session
 * status indicators and the restart-restore feature depend on. Split from terminalStream.test.ts
 * to keep both files under the source-size limit.
 *
 * Busy/idle is owned by the backend's process-tree probe — output bytes alone no longer drive it,
 * so the dot reflects a real running child (vim, ssh, a build tool, an agent CLI) and not the
 * shell's echo of typed keys.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { deleteScrollback, loadScrollback, saveScrollback } from "../utils/scrollbackStore";
import { mockOmnitermAPI } from "../testUtils";
import { attach, bytes, written } from "./terminalStreamHarness";

/** Captured backend busy/idle callback — a test drives it as the real probe would. */
let localActivitySink: ((busy: boolean) => void) | undefined;

beforeEach(() => {
  mockOmnitermAPI();
  localActivitySink = undefined;
});

/** A `connect.onLocalActivity` mock that hands back the callback so a test can drive backend state. */
const captureActivity = () =>
  vi.fn((_id: string, cb: (busy: boolean) => void) => {
    localActivitySink = cb;
    return () => {};
  });

describe("attachTerminalStream — activity and scrollback", () => {
  it("drives busy/idle purely from backend onLocalActivity, not from output bytes", () => {
    mockOmnitermAPI({ connect: { onLocalActivity: captureActivity() } });
    const { fire, onActivity } = attach({ isLocal: true });

    // PTY bytes alone never flip the dot — typed echo, prompt redraws, banner craft are not activity.
    fire.data?.(bytes("typing output, prompt redraw, etc."));
    expect(onActivity).not.toHaveBeenCalled();

    localActivitySink?.(true);
    expect(onActivity).toHaveBeenLastCalledWith(true);

    localActivitySink?.(false);
    expect(onActivity).toHaveBeenLastCalledWith(false);

    // Dedup: a redundant idle event does not fire onActivity again.
    localActivitySink?.(false);
    expect(onActivity.mock.calls.filter(([busy]) => busy === false).length).toBe(1);
  });

  it("clears busy when the stream errors even while bytes are still arriving", () => {
    mockOmnitermAPI({ connect: { onLocalActivity: captureActivity() } });
    const { fire, onActivity } = attach({ isLocal: true });

    localActivitySink?.(true);
    expect(onActivity).toHaveBeenLastCalledWith(true);

    fire.data?.(bytes("partial output"));
    fire.error?.("boom");
    expect(onActivity).toHaveBeenLastCalledWith(false);

    // No second idle flip from a delayed timer — the busy debounce is gone.
    expect(onActivity.mock.calls.filter(([busy]) => busy === false).length).toBe(1);
  });

  it("clears busy when the session exits regardless of backend state", () => {
    mockOmnitermAPI({ connect: { onLocalActivity: captureActivity() } });
    const { fire, onActivity } = attach({ isLocal: true });

    localActivitySink?.(true);
    fire.data?.(bytes("last words"));
    fire.closed?.(0);

    expect(onActivity).toHaveBeenLastCalledWith(false);
    expect(onActivity.mock.calls.filter(([busy]) => busy === false).length).toBe(1);
  });

  it("lets backend idle win even while output is mid-arrival (no output debounce outranks it)", () => {
    mockOmnitermAPI({ connect: { onLocalActivity: captureActivity() } });
    const { fire, onActivity } = attach({ isLocal: true });

    localActivitySink?.(true);
    fire.data?.(bytes("burst after the busy signal"));

    // The previous output-debounce would have held this idle at bay; that was the bug being fixed.
    localActivitySink?.(false);
    expect(onActivity).toHaveBeenLastCalledWith(false);
  });

  it("never drives onActivity on a remote pane (no fixed heuristic on output bytes)", () => {
    const { fire, onActivity } = attach({ isLocal: false });

    fire.data?.(bytes("lots of remote output\r\n"));
    fire.error?.("dropped");
    expect(onActivity).not.toHaveBeenCalled();
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
    // The scrollback flush is debounced 3s — the store still holds only the previous save.
    expect(await loadScrollback("sb-pane-1")).toBe("saved history\r\n");

    stream.dispose();
    await vi.waitFor(async () => {
      expect(await loadScrollback("sb-pane-1")).toBe("saved history\r\nlive output\r\n");
    });
    await deleteScrollback("sb-pane-1");
  });
});
