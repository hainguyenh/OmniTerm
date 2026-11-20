/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { installBrowserGuards } from "../browserGuards";
import { installPageFileDrop, openDropEffect, takePageFileDrop, type DroppedPaths } from "../fileDrop";

/** A drag event carrying `files`, as WebView2 delivers an OS drop with the host's handler off. */
function fileDrag(type: "dragover" | "drop", files: File[], x = 40, y = 60): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.assign(event, { clientX: x, clientY: y });
  Object.defineProperty(event, "dataTransfer", {
    value: { types: ["Files"], files, dropEffect: "none", effectAllowed: "all" },
  });
  return event;
}

describe("installPageFileDrop", () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  function install() {
    const post = vi.fn();
    const opened = vi.fn();
    let answer: (dropped: DroppedPaths) => void = () => {};
    const unlisten = vi.fn();
    dispose = installPageFileDrop({ postMessageWithAdditionalObjects: post }, opened, (onPaths) => {
      answer = onPaths;
      return unlisten;
    });
    return { post, opened, answer: (dropped: DroppedPaths) => answer(dropped), unlisten };
  }

  // Regression: the main window turns the webview's drop handler off, so the Tauri drop event the
  // editor listened for never came and a file dropped on the editor did nothing.
  it("sends dropped files to the host and opens the paths it answers with, where they were dropped", () => {
    const { post, opened, answer } = install();
    const file = new File(["x"], "notes.md");

    const over = fileDrag("dragover", [file]);
    document.body.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);

    const drop = fileDrag("drop", [file], 120, 80);
    document.body.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    // Regression: an object message never reached the host's handler (wry's handler, called
    // first, fails on anything but a string, and WebView2 then stops), so nothing opened.
    expect(post).toHaveBeenCalledWith(JSON.stringify({ omnitermFileDrop: 1 }), [file]);
    expect(typeof post.mock.calls[0]![0]).toBe("string");

    answer({ token: 99, paths: ["D:/other.md"] });
    expect(opened).not.toHaveBeenCalled();
    answer({ token: 1, paths: ["D:/work/notes.md"] });
    expect(opened).toHaveBeenCalledWith(["D:/work/notes.md"], 120, 80);
    // Each drop is answered once.
    answer({ token: 1, paths: ["D:/work/notes.md"] });
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("leaves a drop a region already took, and drags without files", () => {
    const { post } = install();
    const taken = fileDrag("drop", [new File(["x"], "a.txt")]);
    taken.preventDefault();
    document.body.dispatchEvent(taken);

    const text = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(text, "dataTransfer", { value: { types: ["text/plain"], files: [] } });
    document.body.dispatchEvent(text);

    expect(post).not.toHaveBeenCalled();
    expect(text.defaultPrevented).toBe(false);
  });

  // Regression: the browser guards, installed first, cancel every drop on `window`; the page drop
  // listened there too, read the drop as taken by a region and a file dropped on the editor did nothing.
  it("opens a drop although the browser guards cancel it on the window", () => {
    const stopGuards = installBrowserGuards();
    try {
      const { post } = install();
      const over = fileDrag("dragover", [new File(["x"], "a.txt")]);
      document.body.dispatchEvent(over);
      expect(over.dataTransfer!.dropEffect).toBe("link");
      document.body.dispatchEvent(fileDrag("drop", [new File(["x"], "a.txt")]));
      expect(post).toHaveBeenCalledTimes(1);
    } finally {
      stopGuards();
    }
  });

  // Regression: a file dropped on an open editor was read into its document instead of opening.
  it("takes a drop for a region that would consume it, unless the region owns OS drops", () => {
    expect(takePageFileDrop(fileDrag("drop", [new File(["x"], "a.txt")]))).toBe(false);
    const { post, opened, answer } = install();
    const file = new File(["x"], "b.ts");
    expect(takePageFileDrop(fileDrag("drop", [file], 10, 20))).toBe(true);
    expect(post).toHaveBeenCalledWith(JSON.stringify({ omnitermFileDrop: 1 }), [file]);
    answer({ token: 1, paths: ["D:/work/b.ts"] });
    expect(opened).toHaveBeenCalledWith(["D:/work/b.ts"], 10, 20);

    const owner = document.createElement("div");
    owner.setAttribute("data-owns-file-drop", "");
    document.body.append(owner);
    const ownedDrop = fileDrag("drop", [file]);
    Object.defineProperty(ownedDrop, "target", { value: owner });
    expect(takePageFileDrop(ownedDrop)).toBe(false);
    owner.remove();

    dispose?.();
    dispose = undefined;
    expect(takePageFileDrop(fileDrag("drop", [file]))).toBe(false);
  });

  it("does nothing without WebView2 and stops listening when disposed", () => {
    expect(installPageFileDrop(null, vi.fn(), vi.fn())).toBeTypeOf("function");
    const { post, unlisten } = install();
    dispose?.();
    dispose = undefined;
    document.body.dispatchEvent(fileDrag("drop", [new File(["x"], "a.txt")]));
    expect(post).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalled();
  });
});

describe("open drop feedback", () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
  });

  // Regression: the drag read "+ Copy" over the editor although the file opens where it lies.
  it("links the files instead of copying them when the source allows it", () => {
    expect(openDropEffect("all")).toBe("link");
    expect(openDropEffect("copyLink")).toBe("link");
    expect(openDropEffect(undefined)).toBe("link");
    expect(openDropEffect("copy")).toBe("copy");
    expect(openDropEffect("copyMove")).toBe("copy");
  });

  it("labels the drag Open next to the cursor until it leaves or drops", () => {
    vi.useFakeTimers();
    dispose = installPageFileDrop({ postMessageWithAdditionalObjects: vi.fn() }, vi.fn(), () => () => {});
    const over = fileDrag("dragover", [], 100, 200);
    document.body.dispatchEvent(over);
    expect(over.dataTransfer!.dropEffect).toBe("link");
    const hint = document.querySelector<HTMLElement>("[data-file-drop-hint]");
    expect(hint?.textContent).toBe("Open");
    expect(hint?.style.left).toBe("114px");

    // No dragover for a moment: the drag left the window.
    vi.advanceTimersByTime(200);
    expect(document.querySelector("[data-file-drop-hint]")).toBeNull();

    document.body.dispatchEvent(fileDrag("dragover", []));
    document.body.dispatchEvent(fileDrag("drop", [new File(["x"], "a.txt")]));
    expect(document.querySelector("[data-file-drop-hint]")).toBeNull();
  });
});
