import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import MarkdownPreview from '../MarkdownPreview'
import { PREVIEW_LIMITS, type PreviewKind } from './editorFileKinds'
import { debounceFor } from './fileProfile'
import { CsvPreview } from './preview/CsvPreview'
import { HtmlPreview } from './preview/HtmlPreview'
import { JsonGraphPreview } from './preview/JsonGraphPreview'
import { PreviewMessage } from './preview/PreviewMessage'
import { SvgPreview } from './preview/SvgPreview'
import type { TextDocument } from './useTextDocument'

interface PreviewPaneProps {
  kind: PreviewKind
  doc: Pick<TextDocument, 'getText' | 'subscribe'>
  visible: boolean
  fileName: string
  /** Give up on the preview (it hung or threw) and return to the code view with this message. */
  onFallback: (reason: string) => void
  onReveal: (offset: number) => void
}

/**
 * The document's text as of the last pause in typing. Re-read only while the tab is visible: a
 * hidden tab's preview does no work at all, and catches up once when it is shown again.
 */
function useSettledText(doc: PreviewPaneProps['doc'], visible: boolean): string {
  const { getText, subscribe } = doc
  const [text, setText] = useState(getText)
  const length = useRef(text.length)
  length.current = text.length

  useEffect(() => {
    if (!visible) return
    setText(getText())
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setText(getText()), debounceFor(length.current))
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [getText, subscribe, visible])

  return text
}

/** Turns a render-time throw anywhere in a preview into a fallback to the code view. */
class PreviewBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

const MIB = 1024 * 1024
const formatSize = (chars: number) => `${(chars / MIB).toFixed(1)} MB`

export function PreviewPane({ kind, doc, visible, fileName, onFallback, onReveal }: PreviewPaneProps) {
  const text = useSettledText(doc, visible)
  const [forced, setForced] = useState(false)
  const limits = PREVIEW_LIMITS[kind]
  const onMarkdownFallback = useCallback(
    () => onFallback('Preview took too long to render (likely an invalid diagram) — showing the source instead.'),
    [onFallback],
  )
  const onCrash = useCallback(() => onFallback('The preview could not render this file — showing the source instead.'), [onFallback])

  if (text.length > limits.hardCap) {
    return <PreviewMessage text={`This file is too large to preview (${formatSize(text.length)}).`} />
  }
  if (text.length > limits.autoRender && !forced) {
    return (
      <PreviewMessage
        text={`This file is ${formatSize(text.length)}; rendering it may take a while.`}
        onAction={() => setForced(true)}
        actionLabel="Render anyway"
      />
    )
  }

  return (
    <PreviewBoundary onError={onCrash}>
      {kind === 'markdown' && <MarkdownPreview content={text} onFallback={onMarkdownFallback} />}
      {kind === 'html' && <HtmlPreview html={text} />}
      {kind === 'csv' && <CsvPreview text={text} fileName={fileName} />}
      {kind === 'json' && <JsonGraphPreview text={text} onReveal={onReveal} />}
      {kind === 'svg' && <SvgPreview text={text} fileName={fileName} />}
    </PreviewBoundary>
  )
}
