/** The built-in server's URL of a file, and a counter that bumps when the page should reload. */
import { useCallback, useEffect, useState } from "react";
import { onIdeEvent } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { webUrl } from "./browsers";

const RELOAD_DELAY = 250;

export interface ServedPage {
  url: string | null;
  error: string | null;
  /** Key of the frame: a new value reloads it. */
  seq: number;
  reload: () => void;
}

export function useServedPage(path: string): ServedPage {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const root = useProject((s) => s.project?.root ?? null);
  const reload = useCallback(() => setSeq((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setError(null);
    webUrl(path).then(
      (u) => live && setUrl(u),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [path]);

  // Saved edits anywhere in the project (scripts, styles) reload the page.
  useEffect(() => {
    const scope = root ?? path.slice(0, path.lastIndexOf("/"));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, RELOAD_DELAY);
    };
    const offFs = onIdeEvent("fsChanged", (e) => {
      if ([...e.created, ...e.modified, ...e.removed].some((p) => p === scope || p.startsWith(scope + "/"))) schedule();
    });
    const offDirty = onIdeEvent("docDirty", (e) => {
      if (!e.dirty) schedule();
    });
    return () => {
      clearTimeout(timer);
      offFs();
      offDirty();
    };
  }, [path, root, reload]);

  return { url, error, seq, reload };
}
