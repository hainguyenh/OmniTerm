/**
 * OmniTerm: font size controls floating at the bottom-right of a pane (− / reset / +), for the
 * editor or the terminal shown in it, like the inspection widget floats at the top-right. A text
 * editor zooms every editor (IDEA's ⌘ + wheel); a terminal session or web view zooms itself.
 */
import { useEffect, useState, type RefObject } from "react";
import { EditorView } from "@codemirror/view";
import { IconButton } from "@/ui";
import { stepSurfaceFontZoomWithin } from "@/workbench/contributions";
import { resetAllEditorsFontZoom, stepAllEditorsFontZoom } from "../cm/prefs";
import styles from "./EditorArea.module.css";

/** The text editor shown in `root`, not one of a hidden kept-alive tab. */
function shownEditor(root: Element): EditorView | null {
  for (const el of root.querySelectorAll<HTMLElement>(".cm-editor")) {
    if (!el.closest('[aria-hidden="true"]')) return EditorView.findFromDOM(el);
  }
  return null;
}

/** Steps (or, with 0, resets) the font size of what `root` shows; false when nothing there zooms. */
export function stepPaneFontSize(root: Element, delta: number): boolean {
  if (stepSurfaceFontZoomWithin(root, delta)) return true;
  const view = shownEditor(root);
  if (!view) return false;
  if (delta === 0) resetAllEditorsFontZoom();
  else stepAllEditorsFontZoom(view, delta);
  return true;
}

/** Whether `root` shows something zoomable; follows the DOM, since editors mount after the pane. */
function useZoomable(contentRef: RefObject<HTMLElement | null>, key: string): boolean {
  const [zoomable, setZoomable] = useState(false);
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    let observer: MutationObserver | null = null;
    // Stops watching once found: a terminal rewrites its DOM all the time.
    const sync = () => {
      const found = !!root.querySelector(".cm-editor, [data-session-tab], [data-font-zoom]");
      setZoomable(found);
      if (found) observer?.disconnect();
    };
    observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(sync);
    observer?.observe(root, { childList: true, subtree: true });
    sync();
    return () => observer?.disconnect();
  }, [contentRef, key]);
  return zoomable;
}

export function FloatingZoomControls({ contentRef, tabId }: { contentRef: RefObject<HTMLElement | null>; tabId: string }) {
  const zoomable = useZoomable(contentRef, tabId);
  if (!zoomable) return null;
  const step = (delta: number) => {
    const root = contentRef.current;
    if (root) stepPaneFontSize(root, delta);
  };
  return (
    <div className={styles.zoomControls} role="toolbar" aria-label="Font size">
      <IconButton icon="zoom-out" title="Decrease Font Size" size="small" onClick={() => step(-1)} />
      <IconButton icon="actual-size" title="Reset Font Size" size="small" onClick={() => step(0)} />
      <IconButton icon="zoom-in" title="Increase Font Size" size="small" onClick={() => step(1)} />
    </div>
  );
}
