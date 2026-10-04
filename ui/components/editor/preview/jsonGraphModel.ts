/**
 * JSON → node graph in the style of JSON Crack: every object or array is one node listing its
 * primitive members as rows; nested objects and arrays become child nodes joined by an edge.
 *
 * Built iteratively (an explicit stack, never recursion) so a 10,000-level document cannot overflow
 * the call stack, and capped so a huge document yields a readable graph with a "truncated" flag
 * instead of a hundred thousand SVG nodes.
 */

export type JsonValueType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'

export interface GraphRow {
  key: string
  value: string
  type: JsonValueType
}

export interface GraphNode {
  /** JSON Pointer of the value (`#` for the root) — stable across edits, so collapse state survives. */
  id: string
  title: string
  kind: 'object' | 'array' | 'value' | 'more'
  rows: GraphRow[]
  /** Primitive members not listed because of `maxRows`. */
  moreRows: number
  /** Nested objects/arrays under this node, whether or not they are expanded. */
  childCount: number
  collapsed: boolean
  depth: number
  parent: string | null
}

export interface GraphEdge {
  from: string
  to: string
}

export interface JsonGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated: boolean
}

export interface GraphOptions {
  collapsed?: ReadonlySet<string>
  maxNodes?: number
  maxRows?: number
  maxChars?: number
  maxChildren?: number
}

function typeOf(value: unknown): JsonValueType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const type = typeof value
  return type === 'string' || type === 'number' || type === 'boolean' ? type : 'object'
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null
}

function entriesOf(value: Record<string, unknown> | unknown[]): [string, unknown][] {
  return Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value)
}

function display(value: unknown, maxChars: number): string {
  const text = typeof value === 'string' ? JSON.stringify(value) : String(value)
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
}

const escapePointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1')

interface Pending {
  value: unknown
  id: string
  key: string | null
  parent: string | null
  depth: number
  /** Set on the stand-in for children beyond `maxChildren`: how many it represents. */
  more?: number
}

export function buildJsonGraph(root: unknown, options: GraphOptions = {}): JsonGraph {
  const { collapsed = new Set<string>(), maxNodes = 1500, maxRows = 50, maxChars = 80, maxChildren = 200 } = options
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  let truncated = false
  const stack: Pending[] = [{ value: root, id: '#', key: null, parent: null, depth: 0 }]

  while (stack.length > 0) {
    const item = stack.pop()
    if (!item) break
    if (nodes.length >= maxNodes) {
      truncated = true
      break
    }
    if (item.parent !== null) edges.push({ from: item.parent, to: item.id })

    if (item.more !== undefined) {
      nodes.push({
        id: item.id, title: `+${item.more} more`, kind: 'more', rows: [], moreRows: 0, childCount: 0,
        collapsed: false, depth: item.depth, parent: item.parent,
      })
      continue
    }
    if (!isContainer(item.value)) {
      nodes.push({
        id: item.id, title: item.key ?? 'value', kind: 'value', rows: [{ key: '', value: display(item.value, maxChars), type: typeOf(item.value) }],
        moreRows: 0, childCount: 0, collapsed: false, depth: item.depth, parent: item.parent,
      })
      continue
    }

    const isArray = Array.isArray(item.value)
    const entries = entriesOf(item.value)
    const rows: GraphRow[] = []
    let moreRows = 0
    const children: Pending[] = []
    for (const [key, value] of entries) {
      if (isContainer(value)) {
        children.push({ value, id: `${item.id}/${escapePointer(key)}`, key: isArray ? `[${key}]` : key, parent: item.id, depth: item.depth + 1 })
      } else if (rows.length < maxRows) {
        rows.push({ key: isArray ? `[${key}]` : key, value: display(value, maxChars), type: typeOf(value) })
      } else {
        moreRows += 1
      }
    }
    const isCollapsed = collapsed.has(item.id) && children.length > 0
    const label = item.key ?? 'root'
    nodes.push({
      id: item.id, title: `${label} ${isArray ? `[${entries.length}]` : `{${entries.length}}`}`,
      kind: isArray ? 'array' : 'object', rows, moreRows, childCount: children.length,
      collapsed: isCollapsed, depth: item.depth, parent: item.parent,
    })
    if (isCollapsed) continue

    const shown = children.slice(0, maxChildren)
    const hidden = children.length - shown.length
    if (hidden > 0) {
      // Pushed first so it pops last, after the children it stands in for.
      stack.push({ value: undefined, id: `${item.id}/+more`, key: null, parent: item.id, depth: item.depth + 1, more: hidden })
    }
    for (let index = shown.length - 1; index >= 0; index -= 1) stack.push(shown[index])
  }
  return { nodes, edges, truncated }
}
