import { describe, expect, it } from "vitest";
import type { FileStatus } from "@/bindings";
import {
  buildChangeTree,
  buildProjectChangeTree,
  changedRepos,
  changesOfRepo,
  commitTarget,
  groupNodes,
  pickCommitRepo,
  planCommit,
  restrictPlan,
} from "../changes";
import { projectChoices } from "../CommitProjectPicker";

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

  it("lists the projects with changes and falls back to the first", () => {
    expect(changedRepos(status, roots)).toEqual([A, B]);
    expect(pickCommitRepo([A, B], B)).toBe(B);
    expect(pickCommitRepo([A, B], "/gone")).toBe(A);
  });

  it("targets the chosen project while it has changes, nothing with one repository", () => {
    expect(commitTarget(status, roots, B)).toBe(B);
    expect(commitTarget(status.slice(0, 1), roots, B)).toBe(A);
    expect(commitTarget(status, [A], B)).toBeNull();
  });

  it("commits only the target project, even when other projects have included changes", () => {
    const only = restrictPlan(plan, roots, B);
    expect(only.included.map((f) => f.path)).toEqual(["/ws/lib/b.ts"]);
    expect(only.stage.every((p) => p.startsWith(B))).toBe(true);
    expect(restrictPlan(plan, roots, A).included.map((f) => f.path)).toEqual(["/ws/app/src/a.ts"]);
  });

  it("leaves the plan alone without a target", () => {
    expect(restrictPlan(plan, roots, null)).toBe(plan);
  });

  it("shows only the target project's changes, folders relative to it", () => {
    const tree = buildProjectChangeTree(changesOfRepo(status, roots, A), A, "/ws", true);
    expect(tree.map((n) => n.label)).toEqual(["Changes"]);
    expect(tree[0]!.project).toBeUndefined();
    expect(tree[0]!.children![0]).toMatchObject({ type: "dir", label: "src" });
    expect(tree[0]!.files.map((f) => f.path)).toEqual(["/ws/app/src/a.ts"]);
  });

  it("offers one radio per changed project with its change count", () => {
    expect(projectChoices(status, roots)).toEqual([
      { repo: A, count: 1 },
      { repo: B, count: 2 },
    ]);
  });
});
