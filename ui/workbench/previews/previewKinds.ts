import { create } from 'zustand'

export type PreviewWrapperKind = 'markdown' | 'csv' | 'json-graph' | 'html' | 'svg'
export type PreviewMode = 'code' | 'split' | 'preview'

export const usePreviewModeStore = create<{
  modes: Record<string, PreviewMode>
  setMode: (tabId: string, mode: PreviewMode) => void
}>((set) => ({
  modes: {},
  setMode: (tabId, mode) =>
    set((state) => ({
      modes: { ...state.modes, [tabId]: mode },
    })),
}))

export const RASTER_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'])
export const CSV_EXTS = new Set(['csv', 'tsv'])
export const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdx'])
export const JSON_EXTS = new Set(['json', 'geojson'])
export const HTML_EXTS = new Set(['html', 'htm'])
export const SVG_EXTS = new Set(['svg'])

export function getFileExtension(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
}

export function isRasterImage(path: string): boolean {
  return RASTER_IMAGE_EXTS.has(getFileExtension(path))
}

export function isCsv(path: string): boolean {
  return CSV_EXTS.has(getFileExtension(path))
}

export function isMarkdown(path: string): boolean {
  return MARKDOWN_EXTS.has(getFileExtension(path))
}

export function isJson(path: string): boolean {
  return JSON_EXTS.has(getFileExtension(path))
}

export function isHtml(path: string): boolean {
  return HTML_EXTS.has(getFileExtension(path))
}

export function isSvg(path: string): boolean {
  return SVG_EXTS.has(getFileExtension(path))
}
