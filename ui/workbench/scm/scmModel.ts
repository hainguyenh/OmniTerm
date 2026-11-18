import type { ChangeKind, FileStatus } from '../../ide/platform/ipc'

/** One changed file of a repository, as the Source Control view lists it. */
export interface ScmChange {
  path: string
  /** Path relative to the repository. */
  relPath: string
  name: string
  /** Folder of the file inside the repository ('' at its root). */
  dir: string
  letter: string
  kind: ChangeKind
}

/** One repository (project) section: where it is, which branch, and what changed. */
export interface ScmSection {
  root: string
  name: string
  /** Current branch; null when HEAD is detached or unknown. */
  branch: string | null
  /** The repository is in the middle of a merge, rebase, cherry-pick or revert. */
  operation: string | null
  changes: ScmChange[]
}

const LETTERS: Record<ChangeKind, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  ignored: 'I',
  conflicted: '!',
}

/** The letter VS Code shows for a change (M, A, D, R, U for untracked, ! for a conflict). */
export const changeLetter = (kind: ChangeKind): string => LETTERS[kind]

const stripSlash = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '')

/** The innermost of `roots` that contains `path`. */
function ownerOf(path: string, roots: readonly string[]): string | null {
  const target = stripSlash(path)
  let best: string | null = null
  for (const root of roots) {
    const r = stripSlash(root)
    if ((target === r || target.startsWith(`${r}/`)) && (!best || r.length > stripSlash(best).length)) best = root
  }
  return best
}

const baseName = (path: string) => stripSlash(path).split('/').pop() ?? path

/** An unstaged change shows first (it is what a commit of "all changes" would add); else the staged one. */
const kindOf = (status: FileStatus): ChangeKind | null => status.unstaged ?? status.staged

/**
 * Groups the status of the whole workspace by repository, one section per root in the given order
 * (even for a repository with no changes), files by path. Ignored files are left out.
 */
export function buildScmSections(
  roots: readonly string[],
  heads: Readonly<Record<string, { head: string | null }>>,
  operations: Readonly<Record<string, string>>,
  status: readonly FileStatus[],
): ScmSection[] {
  const sections = new Map<string, ScmSection>(
    roots.map((root) => [
      root,
      { root, name: baseName(root), branch: heads[root]?.head ?? null, operation: operations[root] ?? null, changes: [] },
    ]),
  )
  for (const item of status) {
    const kind = kindOf(item)
    const root = ownerOf(item.path, roots)
    if (!kind || kind === 'ignored' || !root) continue
    const rel = item.relPath || stripSlash(item.path).slice(stripSlash(root).length + 1)
    const slash = rel.lastIndexOf('/')
    sections.get(root)?.changes.push({
      path: item.path,
      relPath: rel,
      name: slash < 0 ? rel : rel.slice(slash + 1),
      dir: slash < 0 ? '' : rel.slice(0, slash),
      letter: changeLetter(kind),
      kind,
    })
  }
  for (const section of sections.values()) section.changes.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return [...sections.values()]
}

/** Absolute paths a commit of every change of the section adds (conflicted files are never included). */
export const committablePaths = (section: ScmSection): string[] =>
  section.changes.filter((change) => change.kind !== 'conflicted').map((change) => change.path)
