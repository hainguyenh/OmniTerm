import { describe, expect, it } from "vitest";
import type { FileStatus } from "@/bindings";
import { buildChangeTree, groupNodes, includedRepos, pickCommitRepo, planCommit, restrictPlan } from "../changes";

const file = (path: string, unstaged: FileStatus["unstaged"] = "modified"): FileStatus =>
  ({ path, relPath: path.split("/").slice(3).join("/"), staged: null, unstaged, renamedFrom: null }) as FileStatus;

const A = "/ws/app";
const B = "/ws/lib";
const status = [file("/ws/app/src/a.ts"), file("/ws/lib/b.ts"), file("/ws/lib/new.ts", "untracked" as never)];

describe("project layer of the change tree", () => {
  it("is absent with one repository", () => {
    const tree = buildChangeTree(status.slice(0, 1), A, true, undefined, [A]);
    expect(tree.map((n) => n.label)).toEqual(["Changes"]);
  });

  it("puts the project first, then groups, folders and files", () => {
    const tree = buildChangeTree(status, "/ws", true, undefined, [A, B]);
    expect(tree.map((n) => [n.label, n.project])).toEqual([["app", true], ["lib", true]]);
    const app = tree[0]!;
    expect(app.children!.map((n) => n.label)).toEqual(["Changes"]);
    expect(app.children![0]!.children![0]).toMatchObject({ type: "dir", label: "src" });
    expect(groupNodes(tree).map((n) => n.label)).toEqual(["Changes", "Changes", "Unversioned Files"]);
  });

  it("keeps node keys unique across projects", () => {
    const keys: string[] = [];
    const walk = (nodes: ReturnType<typeof buildChangeTree>) => nodes.forEach((n) => (keys.push(n.key), walk(n.children ?? [])));
    walk(buildChangeTree([file("/ws/app/x.ts"), file("/ws/lib/x.ts")], "/ws", false, undefined, [A, B]));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("commit target project", () => {
  const plan = planCommit(status, new Map());
  const roots = [A, B];

  it("lists the repositories with included files and falls back to the first", () => {
    expect(includedRepos(plan.included, roots)).toEqual([A, B]);
    expect(pickCommitRepo([A, B], B)).toBe(B);
    expect(pickCommitRepo([A, B], "/gone")).toBe(A);
  });

  it("commits only the chosen project", () => {
    const only = restrictPlan(plan, roots, B);
    expect(only.included.map((f) => f.path)).toEqual(["/ws/lib/b.ts"]);
    expect(only.stage.every((p) => p.startsWith(B))).toBe(true);
  });

  it("leaves a single-project plan alone", () => {
    const one = planCommit(status.slice(0, 1), new Map());
    expect(restrictPlan(one, roots, B)).toBe(one);
  });
});
