import { useEffect } from "react";
import { setContext } from "@/platform/context";
import { editorController, useTabs } from "../controller";

/** Makes `paneId` the active pane (a no-op when it already is, or is gone). */
export function activatePane(paneId: string): void {
  const s = useTabs.getState();
  if (s.activePane === paneId || !s.panes[paneId]) return;
  useTabs.setState((st) => ({ ...st, activePane: paneId }), true);
  editorController().publishContext();
}

/**
 * Selects the pane when focus or a press lands anywhere inside its DOM. React's `onFocus` follows
 * the React tree only, and a session tab's terminal is rendered elsewhere and moved into the pane
 * (workbench/sessions/surfaceRegistry.ts): clicking into it focused the terminal, so typing reached
 * that agent, while the other split stayed the selected one until its tab was clicked.
 */
export function usePaneActivation(section: HTMLElement | null, paneId: string): void {
  useEffect(() => {
    if (!section) return undefined;
    const onPress = () => activatePane(paneId);
    const onFocusIn = () => {
      setContext("editorFocus", true);
      activatePane(paneId);
    };
    section.addEventListener("pointerdown", onPress, true);
    section.addEventListener("focusin", onFocusIn);
    return () => {
      section.removeEventListener("pointerdown", onPress, true);
      section.removeEventListener("focusin", onFocusIn);
    };
  }, [section, paneId]);
}
