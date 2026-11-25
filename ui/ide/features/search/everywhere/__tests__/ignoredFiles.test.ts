import { describe, expect, it, vi } from "vitest";

import type { FileMatch, SearchQuery } from "@/platform/ipc";
import { SeController, type SeDeps, type SeSnapshot } from "../controller";

const match = (path: string): FileMatch => ({ path, relPath: path.replace("D:/app/", ""), score: 1, indices: [] });

function controller(over: Partial<SeDeps>) {
  let last: SeSnapshot | null = null;
  const deps: SeDeps = {
    findFiles: vi.fn(async () => [match("D:/app/src/handoff.ts")]),
    findSymbols: vi.fn(async () => []),
    searchText: vi.fn(async () => undefined),
    cancel: vi.fn(),
    nextRequestId: (() => {
      let id = 0;
      return () => ++id;
    })(),
    actions: () => [],
    isEnabled: () => true,
    recentFiles: async () => [],
    recentActions: () => [],
    root: () => "D:/app",
    now: () => 0,
    ...over,
  } as SeDeps;
  const c = new SeController(deps, (s) => (last = s));
  return { c, deps, snapshot: () => last };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Search Everywhere and the folders .gitignore excludes", () => {
  // Regression: a file in an ignored folder (an agent's report under `spdd/reviews`) was never
  // found, even after Search Everywhere widened to non-project items.
  it("adds files of ignored folders after the project's own with Include non-project items", async () => {
    const findIgnoredFiles = vi.fn(async () => [
      match("D:/app/spdd/reviews/56070-[Handoff]-service.md"),
      match("D:/app/src/handoff.ts"),
    ]);
    const { c, snapshot } = controller({ findIgnoredFiles });
    c.run({ query: "handoff", tab: "files", includeNonProject: true, extra: {} });
    await settle();
    const items = snapshot()?.sections.get("files")?.items ?? [];
    expect(items.map((i) => (i.kind === "file" ? i.path : i.kind))).toEqual([
      "D:/app/src/handoff.ts",
      "D:/app/spdd/reviews/56070-[Handoff]-service.md",
    ]);
  });

  it("leaves ignored folders out of a plain project search", async () => {
    const findIgnoredFiles = vi.fn(async () => [match("D:/app/build/handoff.js")]);
    const { c, snapshot } = controller({ findIgnoredFiles });
    c.run({ query: "handoff", tab: "files", includeNonProject: false, extra: {} });
    await settle();
    expect(findIgnoredFiles).not.toHaveBeenCalled();
    expect(snapshot()?.sections.get("files")?.items).toHaveLength(1);
  });

  it("searches text in ignored folders only with Include non-project items", async () => {
    const queries: SearchQuery[] = [];
    const searchText = vi.fn(async (_request: number, query: SearchQuery) => {
      queries.push(query);
    });
    const { c } = controller({ searchText });
    c.run({ query: "needle", tab: "text", includeNonProject: false, extra: {} });
    await settle();
    c.run({ query: "needle", tab: "text", includeNonProject: true, extra: {} });
    await settle();
    expect(queries.map((q) => q.includeIgnored ?? false)).toEqual([false, true]);
  });
});
