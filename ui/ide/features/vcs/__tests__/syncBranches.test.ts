/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import type { Branch } from "@/bindings";
import type { MenuItem } from "@/ui";
import { commonBranchMenu, mergedBranchMenu } from "../branchMenu";
import { buildMergedBranchTree, type BranchTreeNode } from "../branches";
import { buildMultiRepoRows, commonBranches, type CommonBranch, type RepoEntry } from "../repoBranches";

const branch = (name: string, opts: Partial<Branch> = {}): Branch => ({
  name,
  remote: false,
  current: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  lastCommitMs: 0,
  commit: "",
  ...opts,
});
const common = (name: string, opts: Partial<CommonBranch> = {}): CommonBranch => ({
  name,
  remote: false,
  current: false,
  favorite: false,
  upstream: false,
  ...opts,
});
const labels = (items: MenuItem[]) => items.flatMap((i) => ("label" in i && i.label ? [i.label] : []));

describe("commonBranchMenu", () => {
  it("offers Rename for local branches, current or not, and not for remote ones", () => {
    expect(labels(commonBranchMenu(common("feature"), ["/a", "/b"], "main"))).toContain("Rename…");
    expect(labels(commonBranchMenu(common("main", { current: true }), ["/a", "/b"], "main"))).toContain("Rename…");
    expect(labels(commonBranchMenu(common("origin/main", { remote: true }), ["/a", "/b"], "main"))).not.toContain(
      "Rename…",
    );
  });

  it("offers Checkout and Rebase only while the repositories share a current branch", () => {
    const roots = ["/a", "/b"];
    const rebase = (items: MenuItem[]) => labels(items).filter((l) => l.startsWith("Checkout and Rebase"));
    expect(rebase(commonBranchMenu(common("feature"), roots, "main"))).toEqual(["Checkout and Rebase onto 'main'"]);
    expect(rebase(commonBranchMenu(common("feature"), roots, null))).toEqual([]);
    expect(rebase(commonBranchMenu(common("main", { current: true }), roots, "main"))).toEqual([]);
  });
});

describe("mergedBranchMenu", () => {
  const roots = ["/a", "/b"];
  const dev = branch("dev");
  const own = roots.map((repo) => ({ repo, branch: dev }));

  it("acts in every repository that has the branch, with favorites and history", () => {
    const items = labels(mergedBranchMenu(dev, common("dev"), roots, "main", own));
    expect(items).toEqual(expect.arrayContaining(["Merge 'dev' into Current", "Add to Favorites", "Show History"]));
    expect(items.filter((l) => l === "Delete")).toHaveLength(1);
  });

  it("deletes the whole selection when several branches are selected", () => {
    const selected = [...own, { repo: "/a", branch: branch("solo") }];
    const items = labels(mergedBranchMenu(dev, common("dev"), roots, "main", selected));
    expect(items.filter((l) => l === "Delete")).toHaveLength(1);
    expect(items).toContain("Merge 'dev' into Current");
  });

  it("deletes a remote branch in each repository", () => {
    const origin = branch("origin/dev", { remote: true });
    const selected = roots.map((repo) => ({ repo, branch: origin }));
    const items = labels(mergedBranchMenu(origin, common("origin/dev", { remote: true }), roots, "main", selected));
    expect(items).toContain("Delete");
  });
});

describe("buildMergedBranchTree", () => {
  const nodes = (tree: readonly BranchTreeNode[]): BranchTreeNode[] =>
    tree.flatMap((n) => [n, ...nodes(n.children ?? [])]);
  const find = (tree: readonly BranchTreeNode[], key: string) => nodes(tree).find((n) => n.key === key);
  const repo = (root: string, branches: Branch[], tags: string[] = []) => ({
    root,
    name: root.slice(1),
    branches,
    tags,
  });

  it("lists a branch once with the repositories that have it", () => {
    const tree = buildMergedBranchTree(
      [repo("/a", [branch("main"), branch("dev"), branch("feat/x")]), repo("/b", [branch("main"), branch("dev")])],
      null,
      null,
    );
    expect(find(tree, "b:feat/x")?.repos).toEqual(["/a"]);
    expect(find(tree, "b:main")?.repos).toEqual(["/a", "/b"]);
    expect(nodes(tree).filter((n) => n.key === "b:main")).toHaveLength(1);
  });

  it("marks a branch current when it is current in any repository", () => {
    const tree = buildMergedBranchTree(
      [repo("/a", [branch("dev")]), repo("/b", [branch("dev", { current: true })])],
      null,
      null,
    );
    expect(find(tree, "b:dev")?.branch?.current).toBe(true);
  });

  it("uses the current repository's branch", () => {
    const tree = buildMergedBranchTree(
      [repo("/a", [branch("dev", { ahead: 1 })]), repo("/b", [branch("dev", { ahead: 2 })])],
      null,
      "/b",
    );
    expect(find(tree, "b:dev")?.branch?.ahead).toBe(2);
  });

  it("merges tags by name", () => {
    const tree = buildMergedBranchTree([repo("/a", [], ["v1"]), repo("/b", [], ["v1", "v2"])], null, null);
    expect(find(tree, "t:v1")?.repos).toEqual(["/a", "/b"]);
    expect(find(tree, "t:v2")?.repos).toEqual(["/b"]);
  });
});

describe("commonBranches", () => {
  it("marks a common branch with an upstream in any repository", () => {
    const tracked = commonBranches([[branch("dev")], [branch("dev", { upstream: "origin/dev" })]]);
    expect(tracked.local[0]?.upstream).toBe(true);
    expect(commonBranches([[branch("dev")], [branch("dev")]]).local[0]?.upstream).toBe(false);
  });
});

describe("the branches popup with synchronous branch control", () => {
  const A: RepoEntry = { root: "/p/alpha", name: "alpha", head: "main", headCommit: "1" };
  const B: RepoEntry = { root: "/p/beta", name: "beta", head: "feature", headCommit: "2" };
  const input = {
    branches: {
      [A.root]: [branch("main", { current: true }), branch("feature")],
      [B.root]: [branch("main"), branch("feature", { current: true })],
    },
    query: "",
    actions: [],
    expanded: new Map<string, boolean>(),
    current: A.root,
  };

  it("warns that the branches diverged and still lists the common branches", () => {
    const rows = buildMultiRepoRows({ ...input, repos: [A, B], sync: true });
    expect(rows.some((r) => r.type === "notice" && r.label === "Branches have diverged")).toBe(true);
    expect(rows.some((r) => r.type === "group" && r.label === "Common Local Branches")).toBe(true);
  });

  it("lists the current repository's branches when sync is off, even when repositories agree", () => {
    const same = { ...B, head: "main" };
    const rows = buildMultiRepoRows({ ...input, repos: [A, same], sync: false });
    expect(rows.some((r) => r.type === "notice")).toBe(false);
    expect(rows.some((r) => r.type === "group" && r.label === "Common Local Branches")).toBe(false);
    expect(rows.some((r) => r.type === "group" && r.label === "Local Branches in alpha")).toBe(true);
  });
});
