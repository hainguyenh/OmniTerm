/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ask: vi.fn(),
  restore: vi.fn(),
  checkout: vi.fn(),
  rename: vi.fn(),
  rebase: vi.fn(),
  prompt: vi.fn(),
  heads: {} as Record<string, string>,
  ops: {} as Record<string, string | null>,
}));
vi.mock("@/platform/ipc", async (original) => {
  const real = await original<typeof import("@/platform/ipc")>();
  const ok = (data: unknown) => Promise.resolve({ status: "ok" as const, data });
  const fail = (message: string) => Promise.resolve({ status: "error" as const, error: { kind: "failed", message } });
  return {
    ...real,
    isTauri: () => false,
    call: async (p: Promise<{ status: string; data?: unknown; error?: unknown }>) => {
      const r = await p;
      if (r.status === "error") throw r.error;
      return r.data;
    },
    commands: {
      ...real.commands,
      vcsBranchInfo: (root: string) =>
        ok({ head: "main", headCommit: mocks.heads[root], operation: mocks.ops[root] ?? null }),
      vcsRestoreHead: (root: string, before: string, after: string) => {
        mocks.restore(root, before, after);
        return ok(null);
      },
      vcsRenameBranch: (root: string, from: string, to: string, unset: boolean) => {
        mocks.rename(root, from, to, unset);
        if (root === "/b" && from === "feature") return fail("a branch named 'feature2' already exists");
        return ok(null);
      },
      vcsCheckout: (root: string, rev: string) => {
        mocks.checkout(root, rev);
        mocks.heads[root] = `${root}-${rev}`;
        return ok({ kind: "done" });
      },
      vcsRebase: (root: string, onto: string) => {
        mocks.rebase(root, onto);
        if (root === "/b") return fail("rebase refused");
        mocks.heads[root] = `${root}-rebased`;
        return ok(null);
      },
    },
  };
});
vi.mock("@/workbench/messages", () => ({ ask: mocks.ask, showError: vi.fn() }));
vi.mock("../dialogs", async (original) => ({
  ...(await original<typeof import("../dialogs")>()),
  promptText: mocks.prompt,
}));

import { checkoutAndRebaseInRepos, checkoutInRepos, renameInRepos } from "../branchOps";
import { useVcs } from "../store";

describe("checking out a common branch", () => {
  const heads = (h: Record<string, string>) =>
    useVcs.setState({
      heads: Object.fromEntries(Object.entries(h).map(([root, head]) => [root, { head, headCommit: `${root}1` }])),
    } as never);
  beforeEach(() => mocks.checkout.mockReset());

  it("checks out only where it is not the current branch", async () => {
    heads({ "/a": "feature", "/b": "main" });
    await checkoutInRepos("feature", ["/a", "/b"]);
    expect(mocks.checkout.mock.calls).toEqual([["/b", "feature"]]);
  });

  it("does nothing when every repository is already on it", async () => {
    heads({ "/a": "feature", "/b": "feature" });
    await checkoutInRepos("feature", ["/a", "/b"]);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
});

describe("renaming a common branch", () => {
  beforeEach(() => {
    mocks.ask.mockReset();
    mocks.rename.mockReset();
    mocks.prompt.mockReset().mockResolvedValue({ value: "feature2", checked: false });
    mocks.ops = {};
    localStorage.clear();
  });

  it("renames it in every repository", async () => {
    await renameInRepos("feature", ["/a", "/c"], false);
    expect(mocks.rename.mock.calls).toEqual([
      ["/a", "feature", "feature2", false],
      ["/c", "feature", "feature2", false],
    ]);
  });

  it("renames the first back after a failure in the second, on Rollback", async () => {
    mocks.ask.mockResolvedValue({ button: "rollback" });
    await renameInRepos("feature", ["/a", "/b", "/c"], false);
    expect(mocks.rename.mock.calls).toEqual([
      ["/a", "feature", "feature2", false],
      ["/b", "feature", "feature2", false],
      ["/a", "feature2", "feature", false],
    ]);
  });

  const recents = () => JSON.parse(localStorage.getItem("omniterm.vcs.recentBranches:/p") ?? "[]");
  const keepRecents = () => {
    useVcs.setState({ root: "/p" });
    localStorage.setItem("omniterm.vcs.recentBranches:/p", JSON.stringify(["feature", "main"]));
  };

  it("renames the branch in recent branches once it stayed renamed", async () => {
    keepRecents();
    await renameInRepos("feature", ["/a", "/c"], false);
    expect(recents()).toEqual(["feature2", "main"]);
  });

  it("leaves recent branches alone when the rename failed or was rolled back", async () => {
    keepRecents();
    await renameInRepos("feature", ["/b"], false);
    expect(recents()).toEqual(["feature", "main"]);
    mocks.ask.mockResolvedValue({ button: "rollback" });
    await renameInRepos("feature", ["/a", "/b"], false);
    expect(recents()).toEqual(["feature", "main"]);
  });

  it("unsets the upstream only after the branch was renamed in every repository", async () => {
    mocks.prompt.mockResolvedValue({ value: "feature2", checked: true });
    await renameInRepos("feature", ["/a", "/c"], true);
    expect(mocks.rename.mock.calls).toEqual([
      ["/a", "feature", "feature2", false],
      ["/c", "feature", "feature2", false],
      ["/a", "feature2", "feature2", true],
      ["/c", "feature2", "feature2", true],
    ]);
    mocks.rename.mockClear();
    mocks.ask.mockResolvedValue({ button: "rollback" });
    await renameInRepos("feature", ["/a", "/b"], true);
    expect(mocks.rename.mock.calls.some((c) => c[3] === true)).toBe(false);
  });

  it("offers to unset the upstream only when the branch has one", async () => {
    await renameInRepos("feature", ["/a"], true);
    expect(mocks.prompt.mock.calls[0]![0].checkbox).toEqual({ label: "Unset upstream branch", initial: false });
    mocks.prompt.mockClear();
    await renameInRepos("feature", ["/a"], false);
    expect(mocks.prompt.mock.calls[0]![0].checkbox).toBeUndefined();
  });
});

describe("checkout and rebase of a common branch", () => {
  beforeEach(() => {
    mocks.ask.mockReset();
    mocks.checkout.mockReset();
    mocks.rebase.mockReset();
    mocks.restore.mockReset();
    mocks.heads = { "/a": "a1", "/b": "b1", "/c": "c1" };
    mocks.ops = {};
  });

  it("checks the branch out and rebases it onto the current one, repository by repository", async () => {
    await checkoutAndRebaseInRepos("feature", "main", ["/a", "/c"]);
    expect(mocks.checkout.mock.calls).toEqual([
      ["/a", "feature"],
      ["/c", "feature"],
    ]);
    expect(mocks.rebase.mock.calls).toEqual([
      ["/a", "main"],
      ["/c", "main"],
    ]);
  });

  it("restores the branch and checks out the previous one in repositories done before a failure", async () => {
    mocks.ask.mockResolvedValue({ button: "rollback" });
    await checkoutAndRebaseInRepos("feature", "main", ["/a", "/b", "/c"]);
    expect(mocks.rebase.mock.calls.map((c) => c[0])).toEqual(["/a", "/b"]);
    expect(mocks.restore).toHaveBeenCalledWith("/a", "/a-feature", "/a-rebased");
    expect(mocks.checkout.mock.calls.at(-1)).toEqual(["/a", "main"]);
  });

  it("returns the repository whose rebase was refused to the previous branch", async () => {
    mocks.ask.mockResolvedValue({ button: "keep" });
    await checkoutAndRebaseInRepos("feature", "main", ["/a", "/b"]);
    expect(mocks.checkout.mock.calls.filter((c) => c[0] === "/b")).toEqual([
      ["/b", "feature"],
      ["/b", "main"],
    ]);
  });

  it("leaves a repository stopped on rebase conflicts as it is", async () => {
    mocks.ops = { "/b": "rebase" };
    await checkoutAndRebaseInRepos("feature", "main", ["/a", "/b"]);
    expect(mocks.checkout.mock.calls.filter((c) => c[0] === "/b")).toEqual([["/b", "feature"]]);
  });
});
