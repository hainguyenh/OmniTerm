/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { call } = vi.hoisted(() => ({ call: vi.fn(async () => undefined) }));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (message: string) => void = () => undefined;
  },
}));
vi.mock("@/platform/ipc", () => ({
  call,
  commands: { vcsRemote: () => "fetch" },
  isTauri: () => true,
  nextRequestId: () => 1,
}));
vi.mock("@/platform/workflowSettings", () => ({
  onWorkflowSettingsChange: () => () => undefined,
  workflowSettings: () => ({ vcs: { git: { incomingCheck: "auto" } } }),
}));
vi.mock("../ops", () => ({ logConsole: vi.fn() }));
vi.mock("../store", async () => {
  const { create } = await import("zustand");
  return {
    currentRepo: () => "/work/app",
    loadBranches: vi.fn(async () => undefined),
    refreshNow: vi.fn(async () => undefined),
    useVcs: create(() => ({
      root: "/work/app",
      available: true,
      branch: { upstream: "origin/main" },
      remoteBusy: false,
      branchesLoaded: false,
    })),
  };
});

import { installIncomingCheck } from "../incoming";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("incoming commits check", () => {
  let dispose: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    call.mockClear();
    setHidden(false);
  });

  afterEach(() => {
    dispose();
    setHidden(false);
    vi.useRealTimers();
  });

  it("fetches once the first delay has passed while the window is shown", async () => {
    dispose = installIncomingCheck();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("waits until a hidden window is shown again before fetching", async () => {
    dispose = installIncomingCheck();
    setHidden(true);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(call).not.toHaveBeenCalled();
    setHidden(false);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(call).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("does not fetch early when a window that was never due is shown", async () => {
    dispose = installIncomingCheck();
    setHidden(true);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(call).not.toHaveBeenCalled();
  });
});
