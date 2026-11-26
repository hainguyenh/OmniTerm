import { useDebugRunSessions } from "@/workbench/contributions";
import { useRunHeaderPref, runWidgetVisible } from "./headerPref";
import { RunWidget } from "./RunWidget";
import { isLive, useRun } from "./store";

/** The title bar's Run widget, hidden while nothing runs unless the user chose to keep it (see `headerPref`). */
export function RunWidgetGate() {
  const always = useRunHeaderPref((s) => s.always);
  const live = useRun((s) => s.sessions.filter(isLive).length);
  const debugging = useDebugRunSessions((s) => s.sessions.length);
  return runWidgetVisible(always, live, debugging) ? <RunWidget /> : null;
}
