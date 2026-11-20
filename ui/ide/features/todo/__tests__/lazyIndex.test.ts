import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProject } from "@/platform/project";
import { installTodoIndex, requestTodoIndex, useTodos } from "../store";

type ProjectState = ReturnType<typeof useProject.getState>;

function openProject(root: string | null) {
  useProject.setState({ project: root ? ({ root } as ProjectState["project"]) : null });
}

// Outside the desktop app a scan ends at once with `scannedOnce` set, which is enough to tell
// whether one ran.
describe("TODO project index", () => {
  let dispose: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    openProject(null);
    useTodos.setState({ scannedOnce: false, scanning: false, error: null });
  });

  afterEach(() => {
    dispose();
    vi.useRealTimers();
  });

  it("does not scan an opened project until something asks for the index", () => {
    dispose = installTodoIndex();
    openProject("/work/app");
    vi.advanceTimersByTime(10_000);
    expect(useTodos.getState().scannedOnce).toBe(false);
  });

  it("scans right away when the TODO view asks for the index", () => {
    dispose = installTodoIndex();
    openProject("/work/app");
    requestTodoIndex();
    vi.advanceTimersByTime(0);
    expect(useTodos.getState().scannedOnce).toBe(true);
  });

  it("keeps indexing the next project once the view asked for it", () => {
    dispose = installTodoIndex();
    openProject("/work/app");
    requestTodoIndex();
    vi.advanceTimersByTime(0);
    openProject("/work/other");
    expect(useTodos.getState().scannedOnce).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(useTodos.getState().scannedOnce).toBe(true);
  });

  it("forgets the request when the index is uninstalled", () => {
    dispose = installTodoIndex();
    openProject("/work/app");
    requestTodoIndex();
    dispose();
    useTodos.setState({ scannedOnce: false });
    dispose = installTodoIndex();
    openProject("/work/next");
    vi.advanceTimersByTime(10_000);
    expect(useTodos.getState().scannedOnce).toBe(false);
  });
});
