/**
 * Settings › Git › "Explicitly check for incoming commits on remotes": a quiet
 * background fetch (on project open, then every 15 minutes) so the branch
 * widget / Branches popup show incoming commits. `auto` stops for the session
 * after the first failure (credentials needed, offline); `never` disables it.
 * OmniTerm: a check that falls due while the window is hidden waits until it is
 * shown again, so a minimized window does not wake the network every 15 minutes.
 */
import { Channel } from "@tauri-apps/api/core";
import { call, commands, isTauri, nextRequestId } from "@/platform/ipc";
import { onWorkflowSettingsChange, workflowSettings } from "@/platform/workflowSettings";
import { logConsole } from "./ops";
import { currentRepo, loadBranches, refreshNow, useVcs } from "./store";

const FIRST_DELAY = 20_000;
const INTERVAL = 15 * 60_000;
/** A check that fell due while hidden runs this long after the window is shown again. */
const SHOWN_DELAY = 5_000;

export function installIncomingCheck(): () => void {
  if (!isTauri()) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failed = false;
  let root: string | null = null;
  let dueWhileHidden = false;

  const schedule = (delay: number) => {
    clearTimeout(timer);
    const mode = workflowSettings().vcs.git.incomingCheck;
    if (mode === "never" || (mode === "auto" && failed) || !useVcs.getState().available) return;
    dueWhileHidden = false;
    timer = setTimeout(() => void check(), delay);
  };

  const check = async () => {
    if (document.hidden) {
      dueWhileHidden = true;
      return;
    }
    const s = useVcs.getState();
    if (!s.available || !s.branch?.upstream || s.remoteBusy) return schedule(INTERVAL);
    const channel = new Channel<string>();
    channel.onmessage = () => undefined;
    try {
      await call(commands.vcsRemote(currentRepo(), nextRequestId(), { op: "fetch" }, channel));
      await refreshNow();
      if (useVcs.getState().branchesLoaded) void loadBranches().catch(() => undefined);
    } catch (e) {
      failed = true;
      logConsole("info", `Checking for incoming commits failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    schedule(INTERVAL);
  };

  const unsubVcs = useVcs.subscribe((s, prev) => {
    if (s.root === root && s.available === prev.available) return;
    root = s.root;
    failed = false;
    schedule(FIRST_DELAY);
  });
  const unsubSettings = onWorkflowSettingsChange(
    (w) => w.vcs.git.incomingCheck,
    () => {
      failed = false;
      schedule(FIRST_DELAY);
    },
  );
  const onVisibility = () => {
    if (document.hidden || !dueWhileHidden) return;
    dueWhileHidden = false;
    schedule(SHOWN_DELAY);
  };
  document.addEventListener("visibilitychange", onVisibility);
  root = useVcs.getState().root;
  schedule(FIRST_DELAY);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    unsubVcs();
    unsubSettings();
  };
}
