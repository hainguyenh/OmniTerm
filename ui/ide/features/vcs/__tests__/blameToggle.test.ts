/** @vitest-environment jsdom */
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { call, notify } = vi.hoisted(() => ({ call: vi.fn(), notify: vi.fn() }));

vi.mock("@/platform/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/platform/ipc")>()),
  call,
  commands: { vcsBlame: () => "blame" },
}));
vi.mock("@/workbench/contributions", () => ({ notifications: () => ({ notify }) }));
vi.mock("../BlamePopup", () => ({
  closeBlamePopup: vi.fn(),
  scheduleCloseBlamePopup: vi.fn(),
  scheduleOpenBlamePopup: vi.fn(),
}));
vi.mock("../store", () => ({ useVcs: { subscribe: () => () => undefined } }));

import { annotationsShown, blameSlot, toggleAnnotations } from "../blame";

const lines = [
  { commit: "a1", author: "Ann Lee", timeMs: 1_700_000_000_000, summary: "init" },
  { commit: "b2", author: "Bob", timeMs: 1_710_000_000_000, summary: "fix" },
];

function editor(extensions: Extension[]) {
  return new EditorView({ state: EditorState.create({ doc: "one\ntwo", extensions }), parent: document.body });
}

describe("toggleAnnotations", () => {
  beforeEach(() => {
    call.mockReset();
    notify.mockReset();
    document.body.innerHTML = "";
  });

  it("shows the blame gutter, then closes it", async () => {
    call.mockResolvedValue(lines);
    const view = editor([blameSlot()]);
    await toggleAnnotations(view, "/w/a.ts");
    expect(annotationsShown(view)).toBe(true);
    expect(view.dom.querySelector(".cm-vcs-blame")).not.toBeNull();
    await toggleAnnotations(view, "/w/a.ts");
    expect(annotationsShown(view)).toBe(false);
  });

  it("still annotates an editor that was built without the blame slot", async () => {
    call.mockResolvedValue(lines);
    const view = editor([]);
    await toggleAnnotations(view, "/w/a.ts");
    expect(annotationsShown(view)).toBe(true);
    expect(view.dom.querySelector(".cm-vcs-blame")).not.toBeNull();
    await toggleAnnotations(view, "/w/a.ts");
    expect(annotationsShown(view)).toBe(false);
  });

  it("says so instead of showing an empty gutter when nothing is committed", async () => {
    call.mockResolvedValue([]);
    const view = editor([blameSlot()]);
    await toggleAnnotations(view, "/w/a.ts");
    expect(annotationsShown(view)).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Nothing to annotate" }));
  });

  it("reports a failed blame", async () => {
    call.mockRejectedValue(new Error("outside the project"));
    const view = editor([blameSlot()]);
    await toggleAnnotations(view, "/w/a.ts");
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Cannot annotate", body: "outside the project" }));
  });
});
