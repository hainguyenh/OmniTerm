/**
 * @vitest-environment jsdom
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../MarkdownLayoutActions", () => ({ MarkdownLayoutActions: () => <button type="button">layout-actions</button> }));
vi.mock("@/editor/lsp/markdown", () => ({ highlightInto: vi.fn() }));
vi.mock("../mermaid", () => ({ hasMermaid: () => false, MERMAID_SELECTOR: "x", renderMermaidIn: vi.fn() }));
vi.mock("@/ui", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  FloatingToolbar: ({ children }: { children: React.ReactNode }) => <div data-testid="floating-toolbar">{children}</div>,
}));

import { MarkdownEditor } from "../MarkdownEditor";
import { setMarkdownMode } from "../modes";

describe("MarkdownEditor view-mode actions", () => {
  it("keeps the actions reachable in Preview Only, so the editor can be brought back", () => {
    act(() => setMarkdownMode("/w/a.md", "preview"));
    render(<MarkdownEditor path="/w/a.md" tabId="t1"><div>editor</div></MarkdownEditor>);
    expect(screen.getAllByTestId("floating-toolbar")).toHaveLength(1);
    expect(screen.getByText("layout-actions")).toBeTruthy();
  });

  it("shows exactly one toolbar in the other modes, and none when the tab strip carries them", () => {
    act(() => setMarkdownMode("/w/a.md", "split"));
    const { unmount } = render(<MarkdownEditor path="/w/a.md" tabId="t1"><div>editor</div></MarkdownEditor>);
    expect(screen.getAllByTestId("floating-toolbar")).toHaveLength(1);
    unmount();
    act(() => setMarkdownMode("/w/a.md", "preview"));
    render(<MarkdownEditor path="/w/a.md" tabId="t1" actionsInTabs><div>editor</div></MarkdownEditor>);
    expect(screen.queryByTestId("floating-toolbar")).toBeNull();
  });
});
