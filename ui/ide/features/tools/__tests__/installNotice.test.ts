import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  install: vi.fn(),
  restartServers: vi.fn(() => Promise.resolve()),
  cancel: vi.fn(),
  list: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../backend", () => ({ toolsBackend: () => backend }));
vi.mock("@/workbench/tasks", () => ({
  queueTask: (_queue: unknown, _task: unknown, run: () => Promise<unknown>) => run(),
  upsertTask: vi.fn(),
  cancelTask: vi.fn(),
  useTasks: { getState: () => ({ tasks: [] }) },
}));

import { provideNotificationService } from "@/workbench/contributions";
import { notificationServiceImpl, useNotifications } from "@/workbench/notificationStore";
import { installTool, missingKey } from "../store";

const titles = () => useNotifications.getState().items.map((n) => n.title);

describe("install notices", () => {
  beforeEach(() => {
    provideNotificationService(notificationServiceImpl);
    useNotifications.setState({ items: [] });
    backend.install.mockReset();
  });

  // Regression: pressing Install left "is not installed" and its Install button up while the
  // install ran, and the stale notices stayed in the list after it succeeded.
  it("turns the missing notice into Installing…, then into the result, dropping stale ones", async () => {
    const service = notificationServiceImpl;
    service.notify({ level: "warning", title: "Language server 'json' is not installed", key: missingKey("json"), actions: [{ label: "Install", run: () => {} }] });
    service.notify({ level: "error", title: "Failed to install json", key: "tools-install-json" });
    let finish: (info: unknown) => void = () => {};
    backend.install.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    const done = installTool("json");
    await Promise.resolve();
    const installing = useNotifications.getState().items;
    expect(installing.map((n) => n.title)).toEqual(["Installing json…"]);
    expect(installing[0]!.actions?.map((a) => a.label)).toEqual(["Cancel"]);

    finish({ name: "json", displayName: "json", version: "1.0.0", status: "installed" });
    await done;
    expect(titles()).toEqual(["json installed"]);
  });
});
