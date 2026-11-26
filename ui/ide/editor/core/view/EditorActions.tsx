/**
 * OmniTerm: the editor's own actions (contributed `editor.title` buttons such as maximize and
 * detach, a wrapper's layout toggle, Split Right) float at the editor's top-right corner, joined to
 * the inspection widget the way IDEA's floating editor toolbar sits beside the problem counts. The
 * tab strip keeps only what acts on tabs and the pane (Tab Actions ⋮, new session).
 */
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ContributedToolbar } from "@/workbench/ContributedToolbar";
import { IconButton } from "@/ui";
import { editorController } from "../controller";
import type { Tab } from "../model/tabs";
import { textEditorWrapperFor, useTextEditorWrappers } from "@/workbench/contributions";
import styles from "./EditorArea.module.css";
import { activatePane } from "./paneActivation";

/** Class of the corner the inspection widget lives in (`editorCorner()`). */
const CORNER = ".cm-omniterm-corner";
/** The inspection widget's own look, so both read as one floating toolbar. */
const SLOT_CLASS = "cm-omniterm-inspection cm-omniterm-editor-actions";

/** The corner of the editor shown in `root`: not one of a kept-alive, hidden tab. */
export function shownCorner(root: HTMLElement): HTMLElement | null {
  for (const corner of root.querySelectorAll<HTMLElement>(CORNER)) {
    if (!corner.closest('[aria-hidden="true"]')) return corner;
  }
  return null;
}

/**
 * A slot at the start of the shown editor's corner, kept while that corner exists; `null` for an
 * editor without one (images, terminals, other editor kinds), which get a floating box instead.
 */
function useCornerSlot(contentRef: RefObject<HTMLElement | null>, key: string): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    let current: { corner: HTMLElement; slot: HTMLElement } | null = null;
    const sync = () => {
      // Cheap while nothing changed: a terminal in the pane rewrites its DOM all the time.
      if (current?.slot.isConnected && !current.corner.closest('[aria-hidden="true"]')) return;
      const corner = shownCorner(root);
      if (current && current.corner === corner && corner.contains(current.slot)) return;
      current?.slot.remove();
      current = null;
      if (corner) {
        const el = document.createElement("div");
        el.className = SLOT_CLASS;
        el.setAttribute("role", "toolbar");
        el.setAttribute("aria-label", "Editor actions");
        corner.prepend(el);
        current = { corner, slot: el };
      }
      setSlot(current?.slot ?? null);
    };
    sync();
    // The text editor mounts its view (and the inspection widget its corner) after this pane.
    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(sync);
    observer?.observe(root, { childList: true, subtree: true });
    return () => {
      observer?.disconnect();
      current?.slot.remove();
    };
  }, [contentRef, key]);
  return slot;
}

function Actions({ paneId, tab }: { paneId: string; tab: Tab }) {
  const ctrl = editorController();
  const wrappers = useTextEditorWrappers((s) => s.wrappers);
  const LayoutActions =
    tab.input.kind === "file" && tab.input.path
      ? textEditorWrapperFor(wrappers, tab.input.path)?.tabActions
      : undefined;
  return (
    <>
      <ContributedToolbar slot="editor.title" />
      {LayoutActions && <LayoutActions path={tab.input.path!} tabId={tab.id} />}
      <IconButton
        icon="split"
        title="Split Right"
        size="small"
        onClick={() => {
          ctrl.activate(paneId, tab.id, false);
          ctrl.split(paneId, "row");
        }}
      />
    </>
  );
}


export function FloatingEditorActions({
  paneId,
  tab,
  contentRef,
}: {
  paneId: string;
  tab: Tab;
  contentRef: RefObject<HTMLElement | null>;
}) {
  const slot = useCornerSlot(contentRef, tab.id);
  const body: ReactNode = (
    <div
      className={styles.editorActions}
      // Pressing an action makes its pane the active one first, so the action runs for this pane.
      onPointerDownCapture={() => activatePane(paneId)}
    >
      <Actions paneId={paneId} tab={tab} />
    </div>
  );
  if (slot) return createPortal(body, slot);
  return (
    <div className={styles.floatingEditorActions} role="toolbar" aria-label="Editor actions">
      {body}
    </div>
  );
}
