import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileStatus } from "@/bindings";

const openDiff = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../diffInput", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../diffInput")>()),
  openDiff,
}));

import { buildChangeTree } from "../changes";
import { previewInEditor } from "../CommitView";

const file = (path: string): FileStatus =>
  ({ path, relPath: path.slice("/repo/".length), staged: null, unstaged: "modified", renamedFrom: null }) as FileStatus;

describe("Preview Diff of the Commit tab", () => {
  beforeEach(() => openDiff.mockClear());

  const roots = buildChangeTree([file("/repo/a.ts"), file("/repo/b.ts")], "/repo", false);
  const group = roots[0]!;
  const first = group.children![0]!;

  it("opens the selected file's diff in the editor's preview tab, keeping the focus in the tree", () => {
    expect(previewInEditor(first, roots)).toBe(true);
    expect(openDiff).toHaveBeenCalledTimes(1);
    expect(openDiff.mock.calls[0]![1]).toEqual({ preview: true, focus: false });
  });

  it("ignores a group row or an empty selection", () => {
    expect(previewInEditor(group, roots)).toBe(false);
    expect(previewInEditor(undefined, roots)).toBe(false);
    expect(openDiff).not.toHaveBeenCalled();
  });
});
