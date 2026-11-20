import { createElement } from 'react'

import { basename } from '../ide/platform/project'
import {
  registerEditorKind,
  registerFileEditorProvider,
  registerTextEditorWrapper,
  type TextEditorWrapperContribution,
} from '../ide/workbench/contributions'

import { ImageEditorKind } from './previews/ImageEditorKind'
import { NotesEditorKind } from './previews/NotesEditorKind'
import { PreviewTabActions, PreviewWrapper } from './previews/PreviewWrapper'
import {
  isRasterImage,
  CSV_EXTS,
  HTML_EXTS,
  JSON_EXTS,
  MARKDOWN_EXTS,
  SVG_EXTS,
  getFileExtension,
  type PreviewWrapperKind,
} from './previews/previewKinds'

function createPreviewWrapper(
  kind: PreviewWrapperKind,
  matches: (path: string) => boolean,
): TextEditorWrapperContribution {
  return {
    id: `omniterm.${kind}-wrapper`,
    matches,
    // The view-mode switch sits in the tab strip; the wrapper floats it only while tabs are hidden.
    component: ({ path, tabId, children, actionsInTabs }) =>
      createElement(PreviewWrapper, { kind, path, tabId, actionsInTabs }, children),
    tabActions: ({ tabId, path }) => createElement(PreviewTabActions, { tabId, path }),
  }
}

export function registerPreviewKinds(): () => void {
  const disposers: Array<() => void> = []

  // 1. Raster Image File Provider & Editor Kind
  disposers.push(
    registerFileEditorProvider({
      id: 'omniterm.image-provider',
      order: 50,
      resolve: (path) => {
        if (isRasterImage(path)) return { kind: 'image', key: path, path }
        return null
      },
    }),
  )
  disposers.push(
    registerEditorKind({
      kind: 'image',
      component: ImageEditorKind,
      title: (input) => basename(input.path ?? 'Image'),
      icon: () => 'image',
      keepAlive: true,
    }),
  )

  // 2. Temp Notes Editor Kind
  disposers.push(
    registerEditorKind({
      kind: 'notes',
      component: NotesEditorKind,
      title: (input) => (input.data as { title?: string })?.title ?? 'Notes',
      icon: () => 'sticky-note',
      keepAlive: true,
    }),
  )

  // 3. Text Editor Wrappers for Markdown, CSV, JSON, HTML, SVG
  const markdownWrapper = createPreviewWrapper('markdown', (p) => MARKDOWN_EXTS.has(getFileExtension(p)))
  disposers.push(registerTextEditorWrapper(markdownWrapper))

  const csvWrapper = createPreviewWrapper('csv', (p) => CSV_EXTS.has(getFileExtension(p)))
  disposers.push(registerTextEditorWrapper(csvWrapper))

  const jsonWrapper = createPreviewWrapper('json-graph', (p) => JSON_EXTS.has(getFileExtension(p)))
  disposers.push(registerTextEditorWrapper(jsonWrapper))

  const htmlWrapper = createPreviewWrapper('html', (p) => HTML_EXTS.has(getFileExtension(p)))
  disposers.push(registerTextEditorWrapper(htmlWrapper))

  const svgWrapper = createPreviewWrapper('svg', (p) => SVG_EXTS.has(getFileExtension(p)))
  disposers.push(registerTextEditorWrapper(svgWrapper))

  return () => {
    for (const dispose of disposers.reverse()) {
      dispose()
    }
  }
}
