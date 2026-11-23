import { describe, expect, it } from "vitest";
import type { Branch } from "@/bindings";
import { buildMultiRepoRows, type RepoEntry } from "../repoBranches";

const A: RepoEntry = { root: "D:/ws/alpha", name: "alpha", head: "main", headCommit: "1" };
const B: RepoEntry = { root: "D:/ws/beta", name: "beta", head: "feature/x", headCommit: "2" };

const local = (name: string, current = false) => ({ name, current, remote: null }) as unknown as Branch;

const rows = (query: string) =>
  buildMultiRepoRows({
    repos: [A, B],
    branches: { [A.root]: [local("main", true)], [B.root]: [local("feature/x", true), local("beta-fix")] },
    query,
    actions: [{ id: "vcs.newBranch", label: "New Branch…", group: "branch" }],
    expanded: new Map(),
    current: A.root,
    sync: false,
  });

describe("buildMultiRepoRows", () => {
  // Regression: the popup listed every repository as a row (with its HEAD and a branches submenu)
  // under the actions, repeating the project list that already chooses the repository shown.
  it("lists no repository rows, only actions and the current repository's branches", () => {
    const shown = rows("");
    expect(shown.map((r) => r.type as string)).not.toContain("repo");
    expect(shown[0]).toMatchObject({ type: "action" });
    expect(shown.some((r) => r.type === "group" && r.label === "Local Branches in alpha")).toBe(true);
  });

  it("finds other repositories' branches but not the repositories by name", () => {
    const found = rows("beta");
    expect(found.map((r) => r.type as string)).not.toContain("repo");
    expect(found.some((r) => r.type === "branch" && r.repo === B && r.branch.name === "beta-fix")).toBe(true);
  });
});
