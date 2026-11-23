/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ShelvedChangeList } from "@/bindings";

const mocks = vi.hoisted(() => ({
  ipc: vi.fn(),
  unshelve: vi.fn(),
  shelve: vi.fn(),
}));
vi.mock("@/platform/ipc", async (original) => ({
  ...(await original<typeof import("@/platform/ipc")>()),
  call: mocks.ipc,
  commands: {
    ...(await original<typeof import("@/platform/ipc")>()).commands,
    vcsShelves: () => Promise.resolve(null),
    vcsUnshelve: mocks.unshelve,
    vcsShelve: mocks.shelve,
  },
}));
import { shelveSilently, unshelveSilently, useShelf } from "../shelf";
import { useCommit } from "../commitStore";
import { useVcs } from "../store";
import { useChangelists } from "../changelists";
import { VcsDialogHost } from "../dialogs";
import { registerHistoryActions } from "../historyActions";
import { getAction, isActionKeyEnabled } from "@/platform/actions";
import { intellijWindows } from "@/platform/keymaps/intellij-windows";
import { intellijMacos } from "@/platform/keymaps/intellij-macos";
import { useProject } from "@/platform/project";
import { setContext } from "@/platform/context";

const entry: ShelvedChangeList = {
  id: "work",
  name: "Work",
  timeMs: 0,
  branch: null,
  repo: null,
  files: [
    { path: "a.txt", kind: "modified", oldPath: null },
    { path: "b.txt", kind: "added", oldPath: null },
  ],
};
const change = (path: string) => ({
  path,
  relPath: path,
  staged: null,
  unstaged: "modified" as const,
  renamedFrom: null,
});
const lists = (files: Record<string, string> = {}, active = "default") =>
  useChangelists.setState({
    loaded: false,
    state: {
      lists: [
        { id: "default", name: "Changes", comment: "" },
        { id: "work", name: "Work", comment: "" },
      ],
      active,
      files,
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ipc.mockReset().mockImplementation(async (value: unknown) => (await value) ?? []);
  mocks.shelve.mockImplementation(async (name: string, paths: string[]) => ({
    ...entry,
    id: name,
    name,
    files: paths.map((path) => ({ path, kind: "modified", oldPath: null })),
  }));
  mocks.unshelve.mockResolvedValue({ applied: ["a.txt"], conflicts: [] });
  useShelf.setState({ shelves: [entry], loaded: true });
  useVcs.setState({
    root: "/repo",
    roots: ["/repo"],
    available: true,
    status: [change("/repo/a.txt"), change("/repo/b.txt"), change("/repo/c.txt")],
  });
  useProject.setState({ settings: {} as never });
});
afterEach(cleanup);

describe("Shelve Silently / Unshelve Silently", () => {
  it("shelves the selected changes without a dialog, one shelf per changelist named after it", async () => {
    lists({ "b.txt": "work" });
    render(<VcsDialogHost />);
    await act(() => shelveSilently(["/repo/a.txt", "/repo/b.txt"]));
    expect(mocks.shelve.mock.calls).toEqual([
      ["Changes", ["/repo/a.txt"]],
      ["Work", ["/repo/b.txt"]],
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shelves the active changelist's changes when nothing is selected", async () => {
    lists({ "a.txt": "default", "b.txt": "work", "c.txt": "work" }, "work");
    await shelveSilently();
    expect(mocks.shelve.mock.calls).toEqual([["Work", ["/repo/b.txt", "/repo/c.txt"]]]);
  });

  it("names the shelf like the Shelve dialog when the project has one changelist", async () => {
    useChangelists.setState({
      loaded: false,
      state: { lists: [{ id: "default", name: "Changes", comment: "" }], active: "default", files: {} },
    });
    await shelveSilently(["/repo/a.txt"]);
    expect(mocks.shelve.mock.calls).toEqual([["Uncommitted changes", ["/repo/a.txt"]]]);
  });

  it("shelves nothing when there are no changes", async () => {
    lists();
    useVcs.setState({ status: [] });
    await shelveSilently();
    await shelveSilently(["/repo/missing.txt"]);
    expect(mocks.shelve).not.toHaveBeenCalled();
  });

  it("stops after a shelf fails so later changelists stay in the working tree", async () => {
    lists({ "b.txt": "work" });
    mocks.shelve.mockRejectedValueOnce(new Error("disk full"));
    await shelveSilently(["/repo/a.txt", "/repo/b.txt"]);
    expect(mocks.shelve).toHaveBeenCalledTimes(1);
  });

  it("ignores the Changes tab's selection while another Commit tab is shown", async () => {
    lists();
    const off = registerHistoryActions();
    setContext("activeToolWindow", "commit");
    useCommit.setState({ tab: "stashes", selection: ["/repo/b.txt"] });
    try {
      await getAction("vcs.shelveSilently")!.run({ ctx: {} });
      expect(mocks.shelve).not.toHaveBeenCalled();
      useCommit.setState({ tab: "changes" });
      await getAction("vcs.shelveSilently")!.run({ ctx: {} });
      expect(mocks.shelve.mock.calls).toEqual([["Changes", ["/repo/b.txt"]]]);
    } finally {
      off();
      setContext("activeToolWindow", null);
      useCommit.setState({ tab: "changes", selection: [] });
    }
  });

  it("does nothing for a shelf without files", async () => {
    lists();
    await unshelveSilently({ ...entry, files: [] });
    expect(mocks.unshelve).not.toHaveBeenCalled();
  });

  it("unshelves into the changelist named like the shelf, without a dialog", async () => {
    lists();
    render(<VcsDialogHost />);
    await act(() => unshelveSilently(entry));
    expect(mocks.unshelve).toHaveBeenCalledWith("work", false, null);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useChangelists.getState().state.files).toEqual({ "a.txt": "work" });
  });

  it("unshelves into the active changelist when no changelist has the shelf's name", async () => {
    lists({}, "default");
    await unshelveSilently({ ...entry, name: "Experiment" });
    expect(useChangelists.getState().state.files).toEqual({ "a.txt": "default" });
  });

  it("unshelves only the selected file and follows the remove-applied setting", async () => {
    lists();
    useProject.setState({ settings: { vcs: { shelf: { removeApplied: true } } } as never });
    await unshelveSilently(entry, "b.txt");
    expect(mocks.unshelve.mock.calls).toEqual([["work", true, "b.txt"]]);
  });

  it("binds IDEA's shortcuts to the Commit tool window and the focused Shelf", async () => {
    const off = registerHistoryActions();
    try {
      const shelve = getAction("vcs.shelveSilently")!;
      const unshelveAction = getAction("vcs.unshelveSilently")!;
      expect(intellijWindows[shelve.id]).toEqual(["Ctrl+Shift+H"]);
      expect(intellijMacos[shelve.id]).toEqual(["Meta+Shift+H"]);
      expect(intellijWindows[unshelveAction.id]).toEqual(["Ctrl+Alt+U"]);
      expect(intellijMacos[unshelveAction.id]).toEqual(["Meta+Alt+U"]);
      expect(isActionKeyEnabled(shelve, { vcsAvailable: true, activeToolWindow: "commit" })).toBe(true);
      expect(isActionKeyEnabled(shelve, { vcsAvailable: true, activeToolWindow: "commit", shelfFocus: true })).toBe(
        false,
      );
      expect(isActionKeyEnabled(shelve, { vcsAvailable: true, editorTextFocus: true })).toBe(false);
      expect(isActionKeyEnabled(unshelveAction, { vcsAvailable: true, shelfFocus: true })).toBe(true);
      expect(isActionKeyEnabled(unshelveAction, { vcsAvailable: true, editorTextFocus: true })).toBe(false);
      lists();
      await unshelveAction.run({ ctx: {}, arg: { id: "work", path: "a.txt" } });
      expect(mocks.unshelve).toHaveBeenCalledWith("work", false, "a.txt");
    } finally {
      off();
    }
  });
});
