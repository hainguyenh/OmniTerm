/**
 * Opening a `path[:line[:col]]` printed in a terminal in the editor. Shared by the IDE terminal
 * and the workbench session panes, so it stays free of xterm and of the terminal session.
 */
import { call, commands } from "@/platform/ipc";
import { editorService, notifications } from "@/workbench/contributions";
import { resolvePath } from "./links";

export interface FileLink {
  path: string;
  /** 1-based, as printed. */
  line?: number;
  /** 1-based, as printed. */
  col?: number;
  /**
   * Other readings of `path`, tried first: a path an agent's reply broke across two lines, joined
   * back. Each is only taken when it names a file, so a reading that joined prose falls through.
   */
  candidates?: readonly string[];
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await call(commands.fsEntryKind(path))) === "file";
  } catch {
    return false;
  }
}

/** The project file whose path ends with `rel`, from the project index. */
async function indexedFile(rel: string): Promise<string | null> {
  try {
    const hits = await call(commands.findFiles(rel, 5));
    return hits.find((h) => h.relPath === rel || h.relPath.endsWith(`/${rel}`))?.path ?? null;
  } catch {
    return null;
  }
}

const relative = (path: string) => path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");

/**
 * Where `link` points: each reading (the candidates, then the path) against the shell's directory,
 * then against each of `roots` (the projects, for a shell that has `cd`-ed away), then a
 * project-wide lookup. An on-disk check comes first because the project index leaves ignored
 * folders (`.bizreq/outbox`, `test-results`) out.
 */
export async function findFileLink(link: FileLink, cwd: string, roots: readonly string[] = []): Promise<string | null> {
  const readings = [...(link.candidates ?? []), link.path];
  const tried = new Set<string>();
  for (const reading of readings) {
    for (const base of [cwd, ...roots]) {
      if (!base) continue;
      const path = resolvePath(reading, base);
      if (tried.has(path)) continue;
      tried.add(path);
      if (await isFile(path)) return path;
    }
  }
  for (const reading of readings) {
    const hit = await indexedFile(relative(reading));
    if (hit) return hit;
  }
  // The basename alone is ambiguous (`a/x.ts` vs `b/x.ts`): it is the last resort, for the printed
  // path only, and only when that path names a directory the index could not match.
  const rel = relative(link.path);
  const name = rel.split("/").pop() ?? rel;
  return name === rel ? null : indexedFile(name);
}

/** Opens `link` in the editor at its line; a link that names no file shows "File not found". */
export async function openFileLink(link: FileLink, cwd: string, roots: readonly string[] = []): Promise<boolean> {
  const path = await findFileLink(link, cwd, roots);
  if (!path) {
    notifications().notify({ level: "warning", title: "File not found", body: link.path });
    return false;
  }
  const selection = link.line ? { line: link.line - 1, col: Math.max(0, (link.col ?? 1) - 1) } : undefined;
  await editorService().openFile(path, { selection, focus: true });
  return true;
}
