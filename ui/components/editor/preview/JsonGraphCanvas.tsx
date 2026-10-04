import { Maximize, Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

import { HEADER_HEIGHT, ROW_HEIGHT, type GraphLayout, type LaidOutNode } from './jsonGraphLayout'
import {
  cullEdges, cullNodes, fitTransform, TEXT_ZOOM, worldRect, zoomAt, type Transform,
} from './jsonGraphViewport'
import { useScrollViewport } from './useScrollViewport'

interface JsonGraphCanvasProps {
  layout: GraphLayout
  onToggle: (id: string) => void
  /** Extra toolbar buttons from the owner (collapse/expand all). */
  actions?: ReactNode
}

type Update = (transform: Transform) => Transform

/**
 * Pannable, zoomable SVG of a laid-out JSON graph. Only nodes and edges inside the visible world
 * rectangle are rendered; pan and zoom updates are batched to one state change per frame.
 *
 * Wheel scrolls the canvas and Ctrl/Cmd+wheel zooms at the pointer. The wheel listener is native and
 * non-passive so it can stop the event: the app treats Ctrl+wheel on the window as UI zoom.
 */
export function JsonGraphCanvas({ layout, onToggle, actions }: JsonGraphCanvasProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const size = useScrollViewport(host)
  const [transform, setTransform] = useState<Transform | null>(null)
  const pending = useRef<Update[]>([])
  const frame = useRef<number | null>(null)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)

  const schedule = useCallback((update: Update) => {
    pending.current.push(update)
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const updates = pending.current
      pending.current = []
      setTransform((current) => (current ? updates.reduce((acc, apply) => apply(acc), current) : current))
    })
  }, [])
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])

  // Fit once, as soon as there is both a graph and a measured viewport. Later layouts (expanding a
  // node) keep the user's pan and zoom.
  useEffect(() => {
    if (transform === null && size.width > 0 && size.height > 0) setTransform(fitTransform(layout, size))
  }, [transform, layout, size])

  useEffect(() => {
    if (!host) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.ctrlKey || event.metaKey) {
        const rect = host.getBoundingClientRect()
        const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        const factor = Math.exp(-event.deltaY * 0.0015)
        schedule((current) => zoomAt(current, point, factor))
      } else {
        schedule((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }))
      }
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [host, schedule])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button, [data-graph-toggle]'))) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start || start.id !== event.pointerId) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    drag.current = { id: start.id, x: event.clientX, y: event.clientY }
    schedule((current) => ({ ...current, x: current.x + dx, y: current.y + dy }))
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === event.pointerId) drag.current = null
  }

  const view = transform ?? { x: 0, y: 0, k: 1 }
  const area = worldRect(view, size)
  const nodes = cullNodes(layout.nodes, area)
  const edges = cullEdges(layout.edges, area)
  const showText = view.k >= TEXT_ZOOM
  const center = { x: size.width / 2, y: size.height / 2 }

  return (
    <div ref={setHost} className="json-graph" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <div className="json-graph-toolbar">
        {actions}
        <button type="button" aria-label="Fit to view" onClick={() => setTransform(fitTransform(layout, size))}>
          <Maximize className="w-3.5 h-3.5" />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => schedule((current) => zoomAt(current, center, 1 / 1.25))}>
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="json-graph-zoom">{Math.round(view.k * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => schedule((current) => zoomAt(current, center, 1.25))}>
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      {layout.truncated && (
        <div className="json-graph-notice">Large document: showing the first {layout.nodes.length.toLocaleString()} nodes. Collapse branches to see others.</div>
      )}
      <svg className="json-graph-svg" width="100%" height="100%">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {edges.map((edge) => {
            const bend = Math.max(24, (edge.x2 - edge.x1) / 2)
            return (
              <path key={`${edge.from}>${edge.to}`} className="json-graph-edge"
                d={`M${edge.x1} ${edge.y1} C${edge.x1 + bend} ${edge.y1}, ${edge.x2 - bend} ${edge.y2}, ${edge.x2} ${edge.y2}`} />
            )
          })}
          {nodes.map((node) => <GraphNodeView key={node.id} node={node} showText={showText} onToggle={onToggle} />)}
        </g>
      </svg>
    </div>
  )
}

function GraphNodeView({ node, showText, onToggle }: { node: LaidOutNode; showText: boolean; onToggle: (id: string) => void }) {
  return (
    <g transform={`translate(${node.x} ${node.y})`}>
      <rect className={`json-graph-node is-${node.kind}`} width={node.width} height={node.height} rx={6} />
      {showText && (
        <>
          <text className="json-graph-title" x={12} y={18}>{node.title}</text>
          {node.childCount > 0 && (
            <g data-graph-toggle role="button" aria-label={node.collapsed ? `Expand ${node.title}` : `Collapse ${node.title}`}
              className="json-graph-toggle" transform={`translate(${node.width - 24} 6)`} onClick={() => onToggle(node.id)}>
              <rect width={16} height={16} rx={3} />
              <text x={8} y={12} textAnchor="middle">{node.collapsed ? '+' : '−'}</text>
            </g>
          )}
          {node.rows.length + node.moreRows > 0 && (
            <line className="json-graph-divider" x1={0} x2={node.width} y1={HEADER_HEIGHT} y2={HEADER_HEIGHT} />
          )}
          {node.rows.map((row, index) => (
            <text key={index} x={12} y={HEADER_HEIGHT + index * ROW_HEIGHT + 14}>
              {row.key && <tspan className="json-graph-key">{row.key}: </tspan>}
              <tspan className={`json-graph-value is-${row.type}`}>{row.value}</tspan>
            </text>
          ))}
          {node.moreRows > 0 && (
            <text className="json-graph-more" x={12} y={HEADER_HEIGHT + node.rows.length * ROW_HEIGHT + 14}>
              +{node.moreRows} more fields
            </text>
          )}
        </>
      )}
    </g>
  )
}
