import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'

import MarkdownPreview from '../../components/MarkdownPreview'
import { CsvPreview } from '../../components/editor/preview/CsvPreview'
import { HtmlPreview } from '../../components/editor/preview/HtmlPreview'
import { JsonGraphPreview } from '../../components/editor/preview/JsonGraphPreview'
import { SvgPreview } from '../../components/editor/preview/SvgPreview'
import { editorController } from '../../ide/editor/core/controller'
import { basename } from '../../ide/platform/project'
import { executeAction } from '../../ide/platform/actions'
import { copyMenuFor, FloatingToolbar, IconButton, selectableText, showContextMenu } from '../../ide/ui'
import { copySelectionOnKeyDown } from '../../ide/ui/selectableText'

import { isHtml, usePreviewModeStore, type PreviewWrapperKind } from './previewKinds'

const VIEW_MODES = [
  { mode: 'code', icon: 'editor-only', title: 'Editor only' },
  { mode: 'split', icon: 'editor-preview', title: 'Split editor and preview' },
  { mode: 'preview', icon: 'preview-only', title: 'Preview only' },
] as const

/** The view-mode switch: IDE icon buttons, so it takes the active theme's colours and tooltips. */
export function PreviewTabActions({ tabId, path }: { tabId: string; path?: string }) {
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
      {path && isHtml(path) && <OpenInBrowserButton path={path} />}
    </div>
  )
}

/** Opens the HTML file through the built-in local server in the default browser, so scripts and relative assets work. */
function OpenInBrowserButton({ path }: { path: string }) {
  return (
    <IconButton
      icon="web"
      size="small"
      title="Open in Browser (local server)"
      data-testid="preview-open-in-browser"
      onClick={() => void executeAction('web.openInBrowser', { path })}
    />
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
        <PreviewTabActions tabId={tabId} path={path} />
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
        // Hidden with the preview-only layout: the editor's corner actions go with it, so the floating
        // editor actions must not attach there (`shownCorner` skips aria-hidden parents).
        aria-hidden={mode === 'preview' ? true : undefined}
      >
        {children}
        {mode !== 'preview' && floating(codeRef)}
      </div>
      {mode !== 'code' && (
        <div ref={previewRef} className="relative flex flex-1 flex-col min-w-0 min-h-0 h-full overflow-hidden bg-[var(--bg-app)]">
          {/* Preview only has no editor to carry the switch, and a floating one is unreachable over an
              iframe, so this bar stays: Editor only / Split / Preview only, and Open in Browser. */}
          {mode === 'preview' && (
            <div className="flex flex-none items-center justify-end gap-1 border-b border-[var(--border)] px-2 py-0.5" data-testid="preview-only-bar">
              <span className="mr-auto truncate text-[11px] text-[var(--fg-muted)]">{fileName}</span>
              <PreviewTabActions tabId={tabId} path={path} />
            </div>
          )}
          {/* The workbench body is unselectable chrome; the rendered file is content the user reads
              and copies, so it opts back in to mouse selection, with Ctrl+C and a right-click Copy. */}
          <div
            className={`min-h-0 w-full flex-1 overflow-auto outline-none ${selectableText}`}
            data-testid="preview-content"
            // Focusable, so Ctrl+C after a mouse selection reaches this handler.
            tabIndex={-1}
            onKeyDown={(event) => { copySelectionOnKeyDown(event) }}
            onContextMenu={(event) => {
              const items = copyMenuFor(event.target)
              if (!items) return
              event.preventDefault()
              showContextMenu(event, items)
            }}
          >
            {renderVisualizer()}
          </div>
        </div>
      )}
    </div>
  )
}
