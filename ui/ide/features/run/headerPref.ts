import { create } from "zustand";

const KEY = "omniterm.run.headerAlways";

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Whether the title bar's Run widget stays visible while nothing runs. Off by default: the widget
 * then shows only while a run or debug session is live, and the Run tool window's header carries
 * the Run / Debug / Stop buttons the rest of the time.
 */
export const useRunHeaderPref = create<{ always: boolean }>(() => ({ always: stored() }));

export function setRunHeaderAlways(always: boolean): void {
  useRunHeaderPref.setState({ always });
  try {
    localStorage.setItem(KEY, always ? "1" : "0");
  } catch {
    /* storage unavailable: the choice lasts until the window closes */
  }
}

/** Whether the widget is drawn: the user asked for it, or something is running or being debugged. */
export const runWidgetVisible = (always: boolean, liveRuns: number, debugSessions: number): boolean =>
  always || liveRuns > 0 || debugSessions > 0;
