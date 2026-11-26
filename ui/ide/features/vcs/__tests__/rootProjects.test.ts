import { describe, expect, it } from "vitest";
import type { Branch, Worktree } from "@/bindings";
import { buildMultiRepoRows, type RepoEntry } from "../repoBranches";
import { groupRootProjects, syncScope, worktreesByRoot } from "../rootProjects";

const FOLDERS = ["D:/workspace/OmniTerm", "D:/workspace/BizReq", "D:/workspace/Bravo"];
const ROOTS = ["D:/workspace/BizReq", "D:/workspace/Bravo", "D:/workspace/OmniTerm", "D:/workspace/OmniTerm/vendor/lib"];

const worktree = (path: string, branch: string, main = false): Worktree => ({
  path,
  head: "abc",
  branch,
  main,
  locked: false,
  prunable: false,
});

describe("root projects", () => {
  it("groups the repositories by the workspace folder holding them", () => {
    expect(groupRootProjects(ROOTS, FOLDERS)).toEqual([
      { folder: "D:/workspace/OmniTerm", repos: ["D:/workspace/OmniTerm", "D:/workspace/OmniTerm/vendor/lib"] },
      { folder: "D:/workspace/BizReq", repos: ["D:/workspace/BizReq"] },
      { folder: "D:/workspace/Bravo", repos: ["D:/workspace/Bravo"] },
    ]);
    // A folder opened below its repository's root still owns that repository; case and slashes
    // don't matter on Windows paths.
    expect(groupRootProjects(["d:\\code\\mono"], ["D:/code/mono/apps/web"])).toEqual([
      { folder: "D:/code/mono/apps/web", repos: ["d:\\code\\mono"] },
    ]);
    expect(groupRootProjects(["D:/a", "D:/b"], [])).toEqual([{ folder: null, repos: ["D:/a", "D:/b"] }]);
    expect(groupRootProjects(["D:/elsewhere"], FOLDERS)).toEqual([{ folder: null, repos: ["D:/elsewhere"] }]);
  });

  // Regression: three independent projects of a workspace, each on its own branch, showed
  // "Branches have diverged" and offered branch operations across all of them.
  it("syncs branches only within the current repository's root project", () => {
    expect(syncScope(ROOTS, FOLDERS, "D:/workspace/BizReq")).toEqual(["D:/workspace/BizReq"]);
    expect(syncScope(ROOTS, FOLDERS, "D:/workspace/OmniTerm/vendor/lib")).toEqual([
      "D:/workspace/OmniTerm",
      "D:/workspace/OmniTerm/vendor/lib",
    ]);
    expect(syncScope(ROOTS, [], "D:/workspace/BizReq")).toEqual(ROOTS);
    expect(syncScope(ROOTS, FOLDERS, null)).toEqual(ROOTS);
  });

  it("shows the linked worktrees that are not roots of the window under their repository", () => {
    const main = worktree("D:/workspace/OmniTerm", "feat/x", true);
    const agent = worktree("D:/workspace/OmniTerm/.claude/worktrees/agent-1", "worktree-agent-1");
    const opened = worktree("D:/workspace/OmniTerm-fix", "fix");
    const lists = [
      { root: "D:/workspace/OmniTerm", worktrees: [main, agent, opened] },
      { root: "D:/workspace/OmniTerm-fix", worktrees: [main, agent, opened] },
      { root: "D:/workspace/BizReq", worktrees: [worktree("D:/workspace/BizReq", "main", true)] },
    ];
    expect(worktreesByRoot(lists, ["D:/workspace/OmniTerm", "D:/workspace/OmniTerm-fix", "D:/workspace/BizReq"])).toEqual({
      "D:/workspace/OmniTerm": [agent],
    });
  });

  it("leaves the notice and the common branches to the repositories in scope", () => {
    const repo = (root: string, head: string): RepoEntry => ({ root, name: root.split("/").pop()!, head, headCommit: "1" });
    const repos = [repo("D:/workspace/BizReq", "features/a"), repo("D:/workspace/OmniTerm", "develop")];
    const local = (name: string) => ({ name, current: false, remote: null }) as unknown as Branch;
    const rows = (scope?: string[]) =>
      buildMultiRepoRows({
        repos,
        branches: { "D:/workspace/BizReq": [local("features/a")], "D:/workspace/OmniTerm": [local("develop")] },
        query: "",
        actions: [],
        expanded: new Map(),
        current: "D:/workspace/OmniTerm",
        sync: true,
        scope,
      });
    expect(rows().some((r) => r.type === "notice")).toBe(true);
    const scoped = rows(["D:/workspace/OmniTerm"]);
    expect(scoped.some((r) => r.type === "notice")).toBe(false);
    expect(scoped.some((r) => r.type === "common" && r.branch.name === "develop")).toBe(true);
  });
});
