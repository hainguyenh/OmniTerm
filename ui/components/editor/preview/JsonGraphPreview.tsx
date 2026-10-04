import { ChevronsDownUp, ChevronsUpDown, Loader2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { createJsonGraphWorker } from './editorWorkers'
import { JsonGraphCanvas } from './JsonGraphCanvas'
import { handleJsonGraphRequest } from './jsonGraphTask'
import { PreviewMessage } from './PreviewMessage'
import { useWorkerTask } from './useWorkerTask'

interface JsonGraphPreviewProps {
  text: string
  /** Move the code editor's cursor to a character offset (used to jump to a syntax error). */
  onReveal: (offset: number) => void
}

/** JSON as a node graph (JSON Crack style), parsed and laid out in a worker. */
export function JsonGraphPreview({ text, onReveal }: JsonGraphPreviewProps) {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const payload = useMemo(() => ({ text, collapsed }), [text, collapsed])
  const { state, retry } = useWorkerTask(createJsonGraphWorker, handleJsonGraphRequest, payload, { size: text.length })
  const result = state.result

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }, [])

  if (!result) {
    return state.status === 'error'
      ? <PreviewMessage text={state.error ?? 'Preview failed.'} onAction={retry} />
      : <div className="flex items-center justify-center h-full"><Loader2 className="w-5 h-5 animate-spin" aria-label="Loading" /></div>
  }
  if (!result.ok) {
    const where = result.line !== null ? ` (line ${result.line}, column ${result.column})` : ''
    const offset = result.offset
    return (
      <PreviewMessage
        text={`Invalid JSON${where}: ${result.message}`}
        onAction={offset === null ? undefined : () => onReveal(offset)}
        actionLabel="Go to error"
      />
    )
  }

  const layout = result.layout
  const collapseAll = () => setCollapsed(layout.nodes.filter((node) => node.depth === 1 && node.childCount > 0).map((node) => node.id))
  return (
    <JsonGraphCanvas
      layout={layout}
      onToggle={toggle}
      actions={(
        <>
          <button type="button" aria-label="Collapse all" onClick={collapseAll}><ChevronsDownUp className="w-3.5 h-3.5" /></button>
          <button type="button" aria-label="Expand all" onClick={() => setCollapsed([])}><ChevronsUpDown className="w-3.5 h-3.5" /></button>
        </>
      )}
    />
  )
}
