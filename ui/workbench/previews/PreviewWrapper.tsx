import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'

import MarkdownPreview from '../../components/MarkdownPreview'
import { CsvPreview } from '../../components/editor/preview/CsvPreview'
import { HtmlPreview } from '../../components/editor/preview/HtmlPreview'
import { JsonGraphPreview } from '../../components/editor/preview/JsonGraphPreview'
import { SvgPreview } from '../../components/editor/preview/SvgPreview'
import { editorController } from '../../ide/editor/core/controller'
import { basename } from '../../ide/platform/project'
import { FloatingToolbar, IconButton } from '../../ide/ui'

import { usePreviewModeStore, type PreviewWrapperKind } from './previewKinds'

const VIEW_MODES = [
  { mode: 'code', icon: 'editor-only', title: 'Editor only' },
  { mode: 'split', icon: 'editor-preview', title: 'Split editor and preview' },
  { mode: 'preview', icon: 'preview-only', title: 'Preview only' },
] as const

/** The view-mode switch: IDE icon buttons, so it takes the active theme's colours and tooltips. */
export function PreviewTabActions({ tabId }: { tabId: string }) {
  const mode = usePreviewModeStore((s) => s.modes[tabId]) ?? 'split'
  const setMode = usePreviewModeStore((s) => s.setMode)

  return (
    <div className="flex items-center" role="group" aria-label="View mode">
      {VIEW_MODES.map((m) => (
        <IconButton
          key={m.mode}
          icon={m.icon}
          size="small"
          title={m.title}
          pressed={mode === m.mode}
          onClick={() => setMode(tabId, m.mode)}
        />
      ))}
    </div>
  )
}

interface PreviewWrapperProps {
  kind: PreviewWrapperKind
  path: string
  tabId: string
  /** The tab strip shows the view-mode switch, so the wrapper does not float its own. */
  actionsInTabs?: boolean
  children?: ReactNode
}

export function PreviewWrapper({
  kind,
  path,
  tabId,
  actionsInTabs = false,
  children,
}: PreviewWrapperProps) {
  const codeRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const mode = usePreviewModeStore((s) => s.modes[tabId]) ?? 'split'
  const setMode = usePreviewModeStore((s) => s.setMode)
  const ctrl = editorController()

  const initialText = useMemo(() => {
    try {
      return ctrl.manager.get(path)?.sync.localText.toString() ?? ''
    } catch {
      return ''
    }
  }, [ctrl, path])

  const [text, setText] = useState(initialText)

  useEffect(() => {
    let active = true
    const update = () => {
      try {
        const m = ctrl.manager.get(path)
        if (m && active) {
          setText(m.sync.localText.toString())
        }
      } catch {
        // Safe ignore if document is closing or unmounted
      }
    }

    update()

    const slot = ctrl.slotFor(tabId)
    if (slot) {
      const listener = (u: { docChanged: boolean }) => {
        if (u.docChanged) update()
      }
      slot.listeners.add(listener)
      return () => {
        active = false
        slot.listeners.delete(listener)
      }
    }

    const interval = setInterval(update, 500)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [ctrl, path, tabId])

  const handleReveal = useCallback(
    (offset: number) => {
      ctrl.slotFor(tabId)?.reveal({ anchor: offset, head: offset, center: true })
    },
    [ctrl, tabId],
  )

  const fileName = basename(path)

  const renderVisualizer = () => {
    switch (kind) {
      case 'markdown':
        return (
          <MarkdownPreview
            content={text}
            onFallback={() => setMode(tabId, 'code')}
          />
        )
      case 'csv':
        return <CsvPreview text={text} fileName={fileName} />
      case 'json-graph':
        return <JsonGraphPreview text={text} onReveal={handleReveal} />
      case 'html':
        return <HtmlPreview html={text} />
      case 'svg':
        return <SvgPreview text={text} fileName={fileName} />
    }
  }

  // With the tab strip hidden, the view-mode switch floats over the pane showing the code (the
  // preview when that is all there is), not the whole wrapper, so it never covers the preview side.
  const floating = (target: RefObject<HTMLDivElement | null>) =>
    !actionsInTabs && (
      <FloatingToolbar targetRef={target}>
        <PreviewTabActions tabId={tabId} />
      </FloatingToolbar>
    )

  return (
    <div
      className="relative flex h-full w-full min-h-0 min-w-0 overflow-hidden"
      data-preview-wrapper={kind}
    >
      {/* flex-col: the editor host is flex: 1, which only gets a height from a column parent.
          Always rendered, so the editor view is never remounted (it keeps its state in every mode). */}
      <div
        ref={codeRef}
        className={
          mode === 'preview'
            ? 'hidden'
            : mode === 'split'
              ? 'relative flex flex-col flex-1 min-w-0 min-h-0 h-full overflow-hidden border-r border-[var(--border)]'
              : 'relative flex flex-col flex-1 min-w-0 min-h-0 h-full overflow-hidden'
        }
        style={mode === 'preview' ? { display: 'none' } : undefined}
      >
        {children}
        {mode !== 'preview' && floating(codeRef)}
      </div>
      {mode !== 'code' && (
        <div ref={previewRef} className="relative flex-1 min-w-0 min-h-0 h-full overflow-hidden bg-[var(--bg-app)]">
          {mode === 'preview' && floating(previewRef)}
          <div className="h-full w-full overflow-auto">{renderVisualizer()}</div>
        </div>
      )}
    </div>
  )
}
