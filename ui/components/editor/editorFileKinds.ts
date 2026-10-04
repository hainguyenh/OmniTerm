/**
 * Which files the editor offers a rendered preview for, and how much of each it renders without
 * being asked. Above `autoRender` the preview waits for an explicit "Render anyway"; `hardCap` is
 * where even that is refused.
 */

export type PreviewKind = 'markdown' | 'csv' | 'html' | 'json' | 'svg'

/** Kinds the host will actually launch — the renderer half of `LAUNCHABLE_EXTS` in safepath.rs.
 *  `.cmd` is absent because the scan reports it as kind `bat`. */
export const RUNNABLE_KINDS: ReadonlySet<string> = new Set(['bat', 'ps1', 'sh', 'rdp'])

const PREVIEW_BY_EXT: Record<string, PreviewKind> = {
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  csv: 'csv',
  tsv: 'csv',
  html: 'html',
  htm: 'html',
  json: 'json',
  geojson: 'json',
  svg: 'svg',
}

export interface PreviewLimits {
  autoRender: number
  hardCap: number
}

const MIB = 1024 * 1024

export const PREVIEW_LIMITS: Record<PreviewKind, PreviewLimits> = {
  markdown: { autoRender: 1 * MIB, hardCap: 5 * MIB },
  html: { autoRender: 2 * MIB, hardCap: 10 * MIB },
  svg: { autoRender: 2 * MIB, hardCap: 10 * MIB },
  json: { autoRender: 5 * MIB, hardCap: 25 * MIB },
  csv: { autoRender: 25 * MIB, hardCap: 25 * MIB },
}

/** Lowercased extension of a file name, or '' for an extensionless or dot-only name. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

export function previewKindFor(fileName: string): PreviewKind | null {
  return PREVIEW_BY_EXT[extensionOf(fileName)] ?? null
}
