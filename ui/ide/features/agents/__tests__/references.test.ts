import { afterEach, describe, expect, it, vi } from "vitest";

const addReferences = vi.hoisted(() => vi.fn());

vi.mock("@/editor/api", () => ({ activeEditor: () => null }));
vi.mock("../store", () => ({ addReferences }));

import { useProject } from "@/platform/project";
import { sendPaths, setReferenceSink } from "../references";

const ROOT = "D:/work/app";

function openProject(): void {
  useProject.setState({ project: { root: ROOT, name: "app" } as never });
}

afterEach(() => {
  useProject.setState({ project: null });
  addReferences.mockClear();
});

describe("Send to Agent from the Project view", () => {
  // Regression: "Send to Agent" on the project's root node did nothing: the root is not *under*
  // the project folder, so it got no reference and the action returned without a word.
  it("sends the project folder itself as `@./`", () => {
    openProject();
    const sink = vi.fn(() => true);
    const release = setReferenceSink(sink);
    try {
      expect(sendPaths([ROOT])).toBe(true);
      expect(sink).toHaveBeenCalledWith(["@./"], expect.any(Function));
    } finally {
      release();
    }
  });

  it("sends a folder relative to the project", () => {
    openProject();
    const sink = vi.fn(() => true);
    const release = setReferenceSink(sink);
    try {
      expect(sendPaths([`${ROOT}/src/lib`])).toBe(true);
      expect(sink).toHaveBeenCalledWith(["@src/lib"], expect.any(Function));
      expect(addReferences).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it("hands the sink a way to add the references to the chat composer instead", () => {
    openProject();
    let toComposer: (() => void) | undefined;
    const release = setReferenceSink((_mentions, fallback) => {
      toComposer = fallback;
      return true;
    });
    try {
      sendPaths([`${ROOT}/src`]);
      expect(addReferences).not.toHaveBeenCalled();
      toComposer?.();
      expect(addReferences).toHaveBeenCalledWith([{ path: `${ROOT}/src`, rel: "src", mention: "@src" }]);
    } finally {
      release();
    }
  });

  it("reports that nothing was sent for a path outside the project", () => {
    openProject();
    expect(sendPaths(["D:/elsewhere/file.ts"])).toBe(false);
    expect(addReferences).not.toHaveBeenCalled();
  });
});
