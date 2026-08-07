import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCoalescer } from "../utils/coalesce";

describe("createCoalescer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("collapses a burst of schedule() calls into a single run", () => {
    const fn = vi.fn();
    const { schedule } = createCoalescer(fn, 50);
    // Simulates a drag-resize: many callbacks in quick succession.
    for (let i = 0; i < 10; i++) schedule();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("restarts the delay on each call, so it only fires once things settle", () => {
    const fn = vi.fn();
    const { schedule } = createCoalescer(fn, 50);
    schedule();
    vi.advanceTimersByTime(40);
    schedule(); // resets the clock before the first would have fired
    vi.advanceTimersByTime(40);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel() prevents a pending run", () => {
    const fn = vi.fn();
    const { schedule, cancel } = createCoalescer(fn, 50);
    schedule();
    cancel();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });

  it("can be scheduled again after firing", () => {
    const fn = vi.fn();
    const { schedule } = createCoalescer(fn, 50);
    schedule();
    vi.advanceTimersByTime(50);
    schedule();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
