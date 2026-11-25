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
    findFilesNamed: async (name: string) => indexed.filter((h) => h.path.split("/").pop() === name).map((h) => h.path),
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

  // Regression: a path an agent's reply broke across two lines opened neither half.
  it("tries the joined readings first, then the printed path", async () => {
    onDisk.add("D:/work/tests/runs/Sprint 254/latest.html");
    const link = { path: "runs/Sprint", candidates: ["runs/Sprint 254/latest.html", "runs/Sprint254/latest.html"] };
    expect(await findFileLink(link, "D:/elsewhere", ["D:/work/app", "D:/work/tests"])).toBe("D:/work/tests/runs/Sprint 254/latest.html");
    onDisk.add("D:/work/app/src/a.ts");
    expect(await findFileLink({ path: "src/a.ts", candidates: ["src/a.ts More"] }, "D:/work/app")).toBe("D:/work/app/src/a.ts");
  });

  // Regression: a project file with brackets in its name, printed relative to a folder the shell
  // is not in, showed "File not found" (the fuzzy file search ranked it out of its top five).
  it("finds a project file by its name and path tail, preferring the shell's own project", async () => {
    const rel = "spdd/reviews/56070-202611221515-[Handoff]-service-delivery-tc02-tc03.md";
    indexed.push(
      { path: `D:/work/other/${rel}`, relPath: rel },
      { path: `D:/work/app/docs/${rel}`, relPath: `docs/${rel}` },
      { path: "D:/work/app/x/56070-202611221515-[Handoff]-service-delivery-tc02-tc03.md", relPath: "x/n.md" },
    );
    expect(await findFileLink({ path: rel }, "D:/work/app", [])).toBe(`D:/work/app/docs/${rel}`);
    expect(await findFileLink({ path: rel }, "", ["D:/work/other", "D:/work/app"])).toBe(`D:/work/other/${rel}`);
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
