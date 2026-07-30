import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Rendered Markdown (with Mermaid fenced blocks) for `ScriptViewer`'s Preview mode.
 *
 * Markdown parsing itself is synchronous and cannot hang, but a Mermaid diagram's render is async and
 * can be slow or simply never resolve on malformed/huge input. `onFallback` fires once — either because
 * every Mermaid block hasn't settled within `RENDER_TIMEOUT_MS`, or because rendering threw outright —
 * and the caller's job is to drop back to the plain text view it already had.
 */
const RENDER_TIMEOUT_MS = 10_000

interface MarkdownPreviewProps {
  content: string
  onFallback: () => void
}

/** Catches a render throw from ReactMarkdown/remark-gfm (e.g. pathological input) that a try/catch
 *  around a synchronous call cannot: render errors surface through React's own error path. */
class MarkdownErrorBoundary extends React.Component<
  { onError: () => void; children: React.ReactNode },
  { errored: boolean }
> {
  state = { errored: false }
  static getDerivedStateFromError() {
    return { errored: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.errored ? null : this.props.children
  }
}

/** One ```mermaid``` fenced block: renders to SVG via a dynamic import (mermaid is sizable and only
 *  needed once a file with a diagram is actually previewed), falling back to the raw source on error. */
const MermaidBlock: React.FC<{ code: string; onSettled: () => void }> = ({ code, onSettled }) => {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // A DOM id mermaid needs for the SVG it builds — not a security-sensitive id, just unique per block.
  const idRef = useRef(`mermaid-preview-${Math.random().toString(36).slice(2)}`)
  const settledRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    const settle = () => {
      if (settledRef.current) return
      settledRef.current = true
      onSettled()
    }
    import('mermaid')
      .then(({ default: mermaid }) => {
        // 'strict' (the default) sanitizes HTML in labels — diagrams come from files in the user's
        // workspace, not content this app should trust outright.
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
        return mermaid.render(idRef.current, code)
      })
      .then(({ svg: rendered }) => {
        if (cancelled) return
        setSvg(rendered)
        settle()
      })
      .catch(() => {
        if (cancelled) return
        setFailed(true)
        settle()
      })
    return () => { cancelled = true }
  }, [code, onSettled])

  if (failed) {
    return <pre className="markdown-mermaid-fallback">{code}</pre>
  }
  if (!svg) {
    return <div className="markdown-mermaid-loading">Rendering diagram…</div>
  }
  return <div className="markdown-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
}

const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content, onFallback }) => {
  const mermaidCount = useMemo(() => (content.match(/```mermaid\b/g) ?? []).length, [content])
  const settledCount = useRef(0)

  // One watchdog per render of this file's content: if any Mermaid block is still unsettled when it
  // fires, the preview as a whole is judged to have failed and the caller switches back to raw view.
  useEffect(() => {
    settledCount.current = 0
    if (mermaidCount === 0) return
    const timer = setTimeout(() => {
      if (settledCount.current < mermaidCount) onFallback()
    }, RENDER_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [content, mermaidCount, onFallback])

  const handleSettled = useCallback(() => { settledCount.current += 1 }, [])

  return (
    <div className="markdown-preview w-full h-full overflow-auto p-4">
      <MarkdownErrorBoundary onError={onFallback}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code(props) {
              const { className, children } = props
              const lang = /language-(\w+)/.exec(className ?? '')?.[1]
              if (lang === 'mermaid') {
                return <MermaidBlock code={String(children).replace(/\n$/, '')} onSettled={handleSettled} />
              }
              return <code className={className}>{children}</code>
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </MarkdownErrorBoundary>
    </div>
  )
}

export default MarkdownPreview
