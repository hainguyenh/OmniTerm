import { beforeEach, describe, expect, it, vi } from "vitest";

const { onDisk, indexed, openFile, notify } = vi.hoisted(() => ({
  onDisk: new Set<string>(),
  indexed: [] as Array<{ path: string; relPath: string }>,
  openFile: vi.fn(async () => undefined),
  notify: vi.fn(),
}));

vi.mock("@/platform/ipc", () => ({
  call: async (request: Promise<unknown>) => request,
  commands: {
    fsEntryKind: async (path: string) => (onDisk.has(path) ? "file" : null),
    findFiles: async (query: string) => indexed.filter((h) => h.relPath.endsWith(query)),
  },
}));
vi.mock("@/workbench/contributions", () => ({
  editorService: () => ({ openFile }),
  notifications: () => ({ notify }),
}));

import { findFileLink, openFileLink } from "../openFile";

beforeEach(() => {
  onDisk.clear();
  indexed.length = 0;
  openFile.mockClear();
  notify.mockClear();
});

describe("opening a file a terminal printed", () => {
  it("resolves against the shell's directory first", async () => {
    onDisk.add("D:/work/app/pkg/src/a.ts");
    onDisk.add("D:/work/app/src/a.ts");
    expect(await findFileLink({ path: "src/a.ts" }, "D:/work/app/pkg", ["D:/work/app"])).toBe("D:/work/app/pkg/src/a.ts");
  });

  // Regression: a path an agent printed relative to the project (in an ignored folder the index
  // leaves out) was not found once the shell had moved to another directory.
  it("falls back to the project root, then to the project index", async () => {
    onDisk.add("D:/work/app/.bizreq/outbox/56069-decision-task.md");
    expect(await findFileLink({ path: ".bizreq/outbox/56069-decision-task.md" }, "D:/elsewhere", ["D:/work/app"])).toBe(
      "D:/work/app/.bizreq/outbox/56069-decision-task.md",
    );
    indexed.push({ path: "D:/work/app/lib/b.ts", relPath: "lib/b.ts" });
    expect(await findFileLink({ path: "lib/b.ts" }, "", [""])).toBe("D:/work/app/lib/b.ts");
  });

  it("opens the file at the printed line and column", async () => {
    onDisk.add("D:/work/app/src/a.ts");
    expect(await openFileLink({ path: "./src/a.ts", line: 12, col: 5 }, "D:/work/app")).toBe(true);
    expect(openFile).toHaveBeenCalledWith("D:/work/app/src/a.ts", { selection: { line: 11, col: 4 }, focus: true });
  });

  it("says so when nothing matches", async () => {
    expect(await openFileLink({ path: "src/gone.ts" }, "D:/work/app")).toBe(false);
    expect(openFile).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: "File not found", body: "src/gone.ts" }));
  });
});
