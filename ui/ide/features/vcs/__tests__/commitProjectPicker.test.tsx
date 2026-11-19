/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileStatus } from "@/bindings";
import { CommitProjectPicker } from "../CommitProjectPicker";
import { ChangesTree } from "../CommitView";
import { useCommit } from "../commitStore";
import { useVcs } from "../store";

const file = (path: string): FileStatus =>
  ({ path, relPath: path.split("/").slice(3).join("/"), staged: null, unstaged: "modified", renamedFrom: null }) as FileStatus;

const A = "/ws/app";
const B = "/ws/app-wt";

beforeEach(() => {
  localStorage.clear();
  useCommit.setState({ projectsCollapsed: false, commitRepo: null });
  useVcs.setState({
    root: "/ws",
    roots: [A, B],
    status: [file(`${A}/a.ts`), file(`${B}/b.ts`)],
    heads: {
      [A]: { head: "main", headCommit: "1" },
      [B]: { head: "feature/x", headCommit: "2", linkedWorktree: true },
    },
  });
});

afterEach(cleanup);

const choice = (name: string) => screen.getByText(name).closest("label") as HTMLElement;

describe("Commit tab project choice", () => {
  it("shows each project's branch on its own line below the name", () => {
    render(<CommitProjectPicker />);
    const branch = within(choice("app")).getByTestId("commit-project-branch");
    expect(branch.textContent).toBe("main");
    // The branch is not inside the name's line (the name and its change count).
    expect(screen.getByText("app").parentElement?.contains(branch)).toBe(false);
  });

  it("marks a linked worktree, and only that one", () => {
    render(<CommitProjectPicker />);
    expect(within(choice("app-wt")).getByRole("img", { name: "Linked worktree" })).toBeTruthy();
    expect(within(choice("app-wt")).getByText("feature/x")).toBeTruthy();
    expect(within(choice("app")).queryByRole("img", { name: "Linked worktree" })).toBeNull();
  });

  it("collapses to its header, naming the chosen project, and remembers it", () => {
    render(<CommitProjectPicker />);
    const header = screen.getByRole("button", { name: /Projects/ });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("radiogroup")).toBeTruthy();

    act(() => fireEvent.click(header));
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(header.textContent).toContain("app");
    expect(localStorage.getItem("omniterm.vcs.commitProjectsCollapsed")).toBe("true");

    act(() => fireEvent.click(header));
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(localStorage.getItem("omniterm.vcs.commitProjectsCollapsed")).toBe("false");
  });
});

describe("Commit tab toolbar", () => {
  it("has no Preview Diff in Editor button", () => {
    render(<ChangesTree mode="commit" />);
    const toolbar = screen.getByRole("toolbar", { name: "Changes" });
    // The toolbar's other buttons are found by the same query.
    expect(within(toolbar).getByRole("button", { name: /Show as Tree/ })).toBeTruthy();
    expect(screen.queryByTitle(/Preview Diff in Editor/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Preview Diff in Editor/ })).toBeNull();
  });
});
