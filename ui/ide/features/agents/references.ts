/** "Send to Agent": the editor selection or Project view files as `@` references. */
import { activeEditor } from "@/editor/api";
import { projectFolder, useProject } from "@/platform/project";
import { isVirtualUri } from "@/platform/virtualDocs";
import { mentionOf } from "./composerModel";
import { addReferences } from "./store";

/**
 * `path` relative to the project folder holding it. In a workspace of several projects the opened
 * root is a container no file lives under, so the folder is looked up per file.
 */
/** How a reference names the project folder itself: `@./`. */
const PROJECT_ROOT_REL = "./";

function relOf(path: string): string | null {
  const root = projectFolder(useProject.getState().project, path)?.root;
  if (!root) return null;
  // The project folder itself (its root node in the Project view): the agent's working directory.
  if (path === root) return PROJECT_ROOT_REL;
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

/**
 * OmniTerm: where references go first. Its agents are CLIs in terminal sessions, so the host
 * types the `@` mentions into the running agent; `false` leaves them to the chat composer.
 * `toComposer` adds them to the chat composer, for a sink that lets the user choose it (when no
 * agent session runs, for example).
 */
export type ReferenceSink = (mentions: readonly string[], toComposer: () => void) => boolean;

let referenceSink: ReferenceSink | null = null;

export function setReferenceSink(sink: ReferenceSink): () => void {
  referenceSink = sink;
  return () => {
    if (referenceSink === sink) referenceSink = null;
  };
}

type Reference = Parameters<typeof addReferences>[0][number];

function send(refs: Reference[]): void {
  if (referenceSink?.(refs.map((ref) => ref.mention), () => addReferences(refs))) return;
  addReferences(refs);
}

/** The active editor's file, with the selected lines when there is a selection. */
export function sendSelection(): boolean {
  const handle = activeEditor();
  if (!handle || isVirtualUri(handle.ctx.path)) return false;
  const rel = relOf(handle.ctx.path);
  if (!rel) return false;
  const { state } = handle.view;
  const sel = state.selection.main;
  // A selection ending at a line start does not include that line.
  const end = sel.to > sel.from && state.doc.lineAt(sel.to).from === sel.to ? sel.to - 1 : sel.to;
  const lines = sel.empty ? undefined : { from: state.doc.lineAt(sel.from).number, to: state.doc.lineAt(end).number };
  send([{ path: handle.ctx.path, rel, mention: mentionOf(rel, lines) }]);
  return true;
}

/** Files and folders from the Project view. */
export function sendPaths(paths: readonly string[]): boolean {
  if (!useProject.getState().project) return false;
  const refs = paths.flatMap((path) => {
    const rel = relOf(path);
    return rel ? [{ path, rel, mention: mentionOf(rel) }] : [];
  });
  if (refs.length) send(refs);
  return refs.length > 0;
}
