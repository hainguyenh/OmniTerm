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
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await call(commands.fsEntryKind(path))) === "file";
  } catch {
    return false;
  }
}

/**
 * Where `link` points: the path against the shell's directory, then against each of `roots` (the
 * project, for a shell that has `cd`-ed away), then a project-wide lookup by name. An on-disk check
 * comes first because the project index leaves ignored folders (`.bizreq/outbox`) out.
 */
export async function findFileLink(link: FileLink, cwd: string, roots: readonly string[] = []): Promise<string | null> {
  const tried = new Set<string>();
  for (const base of [cwd, ...roots]) {
    if (!base) continue;
    const path = resolvePath(link.path, base);
    if (tried.has(path)) continue;
    tried.add(path);
    if (await isFile(path)) return path;
  }
  // The basename alone is ambiguous (`a/x.ts` vs `b/x.ts`): rank the link's
  // directory part too and verify the hit actually sits on that path, settling
  // for a basename match only when the link names no directory.
  const rel = link.path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  const name = rel.split("/").pop() ?? rel;
  for (const q of rel === name ? [name] : [rel, name]) {
    try {
      const hits = await call(commands.findFiles(q, 5));
      const hit = hits.find((h) => h.relPath === q || h.relPath.endsWith(`/${q}`));
      if (hit) return hit.path;
    } catch {
      /* ignore */
    }
  }
  return null;
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
