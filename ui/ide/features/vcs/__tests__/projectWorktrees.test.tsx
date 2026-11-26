/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Worktree } from "@/bindings";
import { ProjectRadioList } from "../ProjectRadioList";
import { useVcs } from "../store";

const A = "D:/ws/OmniTerm";
const B = "D:/ws/BizReq";

const agent: Worktree = {
  path: "D:/ws/OmniTerm/.claude/worktrees/agent-1",
  head: "abc",
  branch: "worktree-agent-1",
  main: false,
  locked: false,
  prunable: false,
};

beforeEach(() => {
  useVcs.setState({
    root: "D:/ws",
    roots: [A, B],
    heads: { [A]: { head: "feat/x", headCommit: "1" }, [B]: { head: "main", headCommit: "2" } },
  });
});

afterEach(cleanup);

describe("Branches popup project list", () => {
  it("lists each project's linked worktrees under it with their branch, and opens one on click", () => {
    const open = vi.fn();
    render(
      <ProjectRadioList
        repos={[A, B]}
        target={A}
        onChoose={() => undefined}
        collapsed={false}
        onCollapsedChange={() => undefined}
        name="test"
        label="Projects"
        worktrees={{ [A]: [agent] }}
        onOpenWorktree={open}
      />,
    );
    const rows = screen.getAllByTestId("project-worktree");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toBe("agent-1worktree-agent-1");
    // Listed right after its project, before the next one.
    const order = [...document.querySelectorAll("label, [data-testid=project-worktree]")].map((n) => n.textContent ?? "");
    expect(order.findIndex((t) => t.startsWith("agent-1"))).toBe(1);
    fireEvent.click(rows[0]!);
    expect(open).toHaveBeenCalledWith(agent.path);
  });

  it("shows no worktree rows when none are given (the Commit tab)", () => {
    render(
      <ProjectRadioList
        repos={[A, B]}
        target={A}
        onChoose={() => undefined}
        collapsed={false}
        onCollapsedChange={() => undefined}
        name="test"
        label="Projects"
      />,
    );
    expect(screen.queryByTestId("project-worktree")).toBeNull();
  });
});
