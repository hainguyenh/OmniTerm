/**
 * Files dropped from the OS onto the project (or LightEdit) window open in the
 * editor, one tab each; a dropped folder opens as a project (the "Open project in"
 * policy applies). Regions marked with `OWNS_FILE_DROP` (Project view, prompt box)
 * handle their drops themselves.
 */
import { executeAction } from "@/platform/actions";
import { tx } from "@/platform/i18n";
import { call, commands, isTauri } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { isRemoteWindow } from "@/platform/remote";
import { nativeDropPoint } from "@/platform/nativeDrop";
import { editorService, OWNS_FILE_DROP } from "./contributions";

const OWNER_ATTR = Object.keys(OWNS_FILE_DROP)[0]!;

type FileDropHandler = (paths: readonly string[], x: number, y: number) => boolean;
const fileDropHandlers = new Set<FileDropHandler>();

export function registerFileDropHandler(handler: FileDropHandler): () => void {
  fileDropHandlers.add(handler);
  return () => {
    fileDropHandlers.delete(handler);
  };
}

export interface FileDropDeps {
  isDir(path: string): Promise<boolean>;
  openFile(path: string, focus: boolean): Promise<void>;
  openProject(path: string): Promise<void>;
}

/** Whether a drop at CSS pixel (x, y) lands on a region that handles OS drops itself. */
export function dropOwnedAt(x: number, y: number): boolean {
  return !!document.elementFromPoint(x, y)?.closest(`[${OWNER_ATTR}]`);
}

/** Opens the dropped files (the last one focused), then the first dropped folder as a project. */
export async function openDropped(paths: readonly string[], deps: FileDropDeps): Promise<void> {
  const kinds = await Promise.all(paths.map((p) => deps.isDir(p).catch(() => false)));
  const files = paths.filter((_, i) => !kinds[i]);
  const dir = paths.find((_, i) => kinds[i]);
  for (const [i, path] of files.entries())
    await deps.openFile(path, i === files.length - 1).catch((e) => console.warn(`could not open ${path}`, e));
  if (dir) await deps.openProject(dir);
}

const defaultDeps: FileDropDeps = {
  isDir: (path) => call(commands.fsReadDir(path)).then(() => true),
  openFile: (path, focus) => editorService().openFile(path, { focus }),
  openProject: async (path) => void (await executeAction("file.openProjectPath", path)),
};

/** Handles one drop; null when it is left to another handler (no local project or LightEdit: the Welcome screen). */
export function handleFileDrop(
  paths: readonly string[],
  x: number,
  y: number,
  deps: FileDropDeps = defaultDeps,
): Promise<void> | null {
  for (const handler of fileDropHandlers) if (paths.length && handler(paths, x, y)) return Promise.resolve();
  const { project, lightEdit } = useProject.getState();
  if (!paths.length || !(project || lightEdit) || isRemoteWindow() || dropOwnedAt(x, y)) return null;
  return openDropped(paths, deps);
}

/** WebView2's channel to the host, which turns a dropped `File` into its path (Windows). */
export interface WebviewFileBridge {
  postMessageWithAdditionalObjects(message: unknown, objects: readonly File[]): void;
}

export interface DroppedPaths {
  token: number;
  paths: string[];
}

/** The event the host answers a page drop with (`src-tauri/src/native_file_drop.rs`). */
const DROPPED_PATHS_EVENT = "omniterm:native-file-drop";

function webviewFileBridge(): WebviewFileBridge | null {
  const webview = (window as { chrome?: { webview?: Partial<WebviewFileBridge> } }).chrome?.webview;
  return typeof webview?.postMessageWithAdditionalObjects === "function" ? (webview as WebviewFileBridge) : null;
}

function listenDroppedPaths(onPaths: (dropped: DroppedPaths) => void): () => void {
  let unlisten: (() => void) | undefined;
  let disposed = false;
  void import("@tauri-apps/api/webviewWindow")
    .then(({ getCurrentWebviewWindow }) =>
      getCurrentWebviewWindow().listen<DroppedPaths>(DROPPED_PATHS_EVENT, (event) => onPaths(event.payload)),
    )
    .then((u) => {
      if (disposed) u();
      else unlisten = u;
    });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/**
 * The drop effect for files that open in place. Windows labels the drag with the effect ("Copy",
 * "Move", "Link") and a page cannot name it "Open"; a link is what an open is, the file read where
 * it lies. Sources that do not offer a link (some apps offer copy only) keep the copy effect, which
 * they would otherwise refuse the drop over.
 */
export function openDropEffect(effectAllowed: string | undefined): "link" | "copy" {
  const allowed = effectAllowed ?? "all";
  return allowed === "all" || allowed === "uninitialized" || /link/i.test(allowed) ? "link" : "copy";
}

/** How long after the last `dragover` the "Open" hint stays (the drag left the window or ended). */
const HINT_LINGER_MS = 150;

/** The "Open" label next to the cursor while files dragged from the OS would open in the editor. */
function createOpenHint(): { show(x: number, y: number): void; hide(): void } {
  let element: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(timer);
    timer = undefined;
    element?.remove();
    element = null;
  };
  return {
    show(x, y) {
      if (!element) {
        element = document.createElement("div");
        element.dataset.fileDropHint = "";
        element.setAttribute("aria-hidden", "true");
        element.textContent = tx("Open");
        Object.assign(element.style, {
          position: "fixed",
          zIndex: "2147483647",
          pointerEvents: "none",
          padding: "2px 8px",
          borderRadius: "4px",
          font: "12px/18px var(--font-ui, system-ui, sans-serif)",
          color: "var(--fg-strong, #fff)",
          background: "var(--bg-popup, #2b2d30)",
          border: "1px solid var(--border-popup, #43454a)",
          boxShadow: "0 2px 8px rgb(0 0 0 / 30%)",
        });
        document.body.append(element);
      }
      // Above and right of the cursor: the OS draws the file and its own badge below it.
      element.style.left = `${x + 14}px`;
      element.style.top = `${y - 26}px`;
      clearTimeout(timer);
      timer = setTimeout(hide, HINT_LINGER_MS);
    },
    hide,
  };
}

/**
 * OS drops the page receives itself. A window that turns the webview's drop handler off (OmniTerm's
 * main window, so pane headers can be dragged) gets dropped files as HTML5 `File`s without paths
 * and never the Tauri drag-drop event above. The files go to the host through WebView2, which
 * answers with their paths; the drop then opens them like any other. A region that took the drop
 * (a terminal attaching the file) or owns OS drops is left alone.
 */
export function installPageFileDrop(
  bridge: WebviewFileBridge | null = webviewFileBridge(),
  onPaths: (paths: readonly string[], x: number, y: number) => void = (paths, x, y) => void handleFileDrop(paths, x, y),
  subscribe: (onPaths: (dropped: DroppedPaths) => void) => () => void = listenDroppedPaths,
): () => void {
  if (!bridge) return () => {};
  const pending = new Map<number, { x: number; y: number }>();
  let next = 0;
  const owned = (e: DragEvent) => e.target instanceof Element && !!e.target.closest(`[${OWNER_ATTR}]`);
  const accepts = (e: DragEvent) => carriesFiles(e) && !e.defaultPrevented && !owned(e);
  const hint = createOpenHint();
  const onDragOver = (e: DragEvent) => {
    if (!accepts(e)) {
      hint.hide();
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = openDropEffect(e.dataTransfer.effectAllowed);
    hint.show(e.clientX, e.clientY);
  };
  const onDrop = (e: DragEvent) => {
    hint.hide();
    if (!accepts(e)) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    const token = ++next;
    pending.set(token, { x: e.clientX, y: e.clientY });
    try {
      bridge.postMessageWithAdditionalObjects({ omnitermFileDrop: token }, files);
    } catch (error) {
      // WebView2 refuses files that are not on disk (dragged out of another app's memory).
      pending.delete(token);
      console.warn("could not open the dropped files", error);
    }
  };
  const unlisten = subscribe(({ token, paths }) => {
    const at = pending.get(token);
    if (!at) return;
    pending.delete(token);
    onPaths(paths, at.x, at.y);
  });
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("drop", onDrop);
  return () => {
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("drop", onDrop);
    hint.hide();
    unlisten();
  };
}

export function installFileDrop(): () => void {
  if (!isTauri()) return () => {};
  const stopPageDrop = installPageFileDrop();
  let unlisten: (() => void) | undefined;
  let disposed = false;
  void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type !== "drop") return;
        const { x, y } = nativeDropPoint(p.position);
        void handleFileDrop(p.paths, x, y);
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      }),
  );
  return () => {
    disposed = true;
    unlisten?.();
    stopPageDrop();
  };
}
