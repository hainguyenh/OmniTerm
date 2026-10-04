import type { GraphNode, JsonGraph } from './jsonGraphModel'

/**
 * Left-to-right tidy tree layout for the JSON graph, O(n) and DOM-free so it runs in the worker.
 *
 * Node sizes come from character counts at a fixed monospace advance instead of measuring text.
 * Columns are one per depth, as wide as their widest node; vertically, each subtree gets a band as tall
 * as the larger of its root and the stacked bands of its children, and the root is centred on it.
 */

export const CHAR_WIDTH = 7.2
export const ROW_HEIGHT = 18
export const HEADER_HEIGHT = 28
const PADDING_X = 12
const MIN_WIDTH = 140
const MAX_WIDTH = 420
const COLUMN_GAP = 80
const SIBLING_GAP = 16

export interface LaidOutRow {
  key: string
  value: string
  type: GraphNode['rows'][number]['type']
}

export interface LaidOutNode extends Omit<GraphNode, 'rows'> {
  rows: LaidOutRow[]
  x: number
  y: number
  width: number
  height: number
}

export interface LaidOutEdge {
  from: string
  to: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface GraphLayout {
  nodes: LaidOutNode[]
  edges: LaidOutEdge[]
  width: number
  height: number
  truncated: boolean
}

function rowChars(key: string, value: string): number {
  return key ? key.length + 2 + value.length : value.length
}

function clip(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, Math.max(1, chars - 1))}…` : text
}

function sizeNode(node: GraphNode): LaidOutNode {
  const widest = Math.max(node.title.length + 3, ...node.rows.map((row) => rowChars(row.key, row.value)))
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, widest * CHAR_WIDTH + PADDING_X * 2))
  const fit = Math.floor((width - PADDING_X * 2) / CHAR_WIDTH)
  // Rows that would overflow the capped width are shortened here, so the renderer never clips.
  const rows = node.rows.map((row) => {
    const keyPart = row.key ? Math.min(row.key.length, Math.floor(fit / 2)) : 0
    const key = clip(row.key, keyPart)
    return { key, value: clip(row.value, fit - (key ? key.length + 2 : 0)), type: row.type }
  })
  const lines = rows.length + (node.moreRows > 0 ? 1 : 0)
  const height = HEADER_HEIGHT + lines * ROW_HEIGHT + (lines > 0 ? 8 : 0)
  return { ...node, title: clip(node.title, fit - 2), rows, x: 0, y: 0, width, height }
}

/** Lay out a graph whose nodes arrive in pre-order (every parent before its children). */
export function layoutJsonGraph(graph: JsonGraph): GraphLayout {
  const nodes = graph.nodes.map(sizeNode)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map<string, LaidOutNode[]>()
  const columnWidth: number[] = []
  for (const node of nodes) {
    columnWidth[node.depth] = Math.max(columnWidth[node.depth] ?? 0, node.width)
    if (node.parent !== null) {
      const list = children.get(node.parent)
      if (list) list.push(node)
      else children.set(node.parent, [node])
    }
  }
  const columnX: number[] = []
  columnWidth.forEach((_, depth) => {
    columnX[depth] = depth === 0 ? 0 : columnX[depth - 1] + columnWidth[depth - 1] + COLUMN_GAP
  })

  // Bottom-up: reverse pre-order visits every child before its parent.
  const band = new Map<string, number>()
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    const kids = children.get(node.id) ?? []
    const stacked = kids.reduce((sum, kid) => sum + (band.get(kid.id) ?? kid.height), 0) + SIBLING_GAP * Math.max(0, kids.length - 1)
    band.set(node.id, Math.max(node.height, stacked))
  }

  // Top-down: place each node centred in its band and hand its children their sub-bands.
  const top = new Map<string, number>()
  let cursor = 0
  for (const node of nodes) {
    let start = top.get(node.id)
    if (start === undefined) {
      // A root (only `#`, but robust to a forest): stack roots one under another.
      start = cursor
      cursor += (band.get(node.id) ?? node.height) + SIBLING_GAP
    }
    const own = band.get(node.id) ?? node.height
    node.x = columnX[node.depth]
    node.y = start + (own - node.height) / 2
    const kids = children.get(node.id) ?? []
    const stacked = kids.reduce((sum, kid) => sum + (band.get(kid.id) ?? kid.height), 0) + SIBLING_GAP * Math.max(0, kids.length - 1)
    let childTop = start + (own - stacked) / 2
    for (const kid of kids) {
      top.set(kid.id, childTop)
      childTop += (band.get(kid.id) ?? kid.height) + SIBLING_GAP
    }
  }

  const edges: LaidOutEdge[] = []
  for (const edge of graph.edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    edges.push({
      from: edge.from, to: edge.to,
      x1: from.x + from.width, y1: from.y + from.height / 2,
      x2: to.x, y2: to.y + to.height / 2,
    })
  }

  const width = nodes.reduce((max, node) => Math.max(max, node.x + node.width), 0)
  const height = nodes.reduce((max, node) => Math.max(max, node.y + node.height), 0)
  return { nodes, edges, width, height, truncated: graph.truncated }
}
