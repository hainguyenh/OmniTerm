import { describe, expect, it } from 'vitest'

import { layoutJsonGraph } from '../jsonGraphLayout'
import { buildJsonGraph } from '../jsonGraphModel'
import { handleJsonGraphRequest, locateJsonError } from '../jsonGraphTask'
import { cullEdges, cullNodes, fitTransform, MAX_ZOOM, MIN_ZOOM, worldRect, zoomAt } from '../jsonGraphViewport'

const SAMPLE = {
  name: 'app',
  version: 2,
  private: true,
  license: null,
  scripts: { build: 'vite', test: 'vitest' },
  tags: ['a', 'b', { deep: [1, 2] }],
}

describe('buildJsonGraph', () => {
  it('turns objects and arrays into nodes with primitive rows and child edges', () => {
    const graph = buildJsonGraph(SAMPLE)
    const ids = graph.nodes.map((node) => node.id)
    expect(ids).toEqual(['#', '#/scripts', '#/tags', '#/tags/2', '#/tags/2/deep'])
    const root = graph.nodes[0]
    expect(root.title).toBe('root {6}')
    expect(root.rows.map((row) => `${row.key}=${row.value}:${row.type}`)).toEqual([
      'name="app":string', 'version=2:number', 'private=true:boolean', 'license=null:null',
    ])
    expect(root.childCount).toBe(2)
    expect(graph.nodes[2].title).toBe('tags [3]')
    expect(graph.nodes[2].rows[0].key).toBe('[0]')
    expect(graph.edges).toContainEqual({ from: '#/tags', to: '#/tags/2' })
    expect(graph.truncated).toBe(false)
  })

  it('collapses nodes by pointer and escapes pointer segments', () => {
    const graph = buildJsonGraph({ 'a/b': { 'c~d': {} } }, { collapsed: new Set(['#/a~1b']) })
    expect(graph.nodes.map((node) => node.id)).toEqual(['#', '#/a~1b'])
    expect(graph.nodes[1].collapsed).toBe(true)
    expect(buildJsonGraph({ x: {} }, { collapsed: new Set(['#/x']) }).nodes[1].collapsed).toBe(false)
  })

  it('caps rows, children and nodes', () => {
    const wide = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`k${index}`, index]))
    expect(buildJsonGraph(wide, { maxRows: 50 }).nodes[0].moreRows).toBe(10)
    const many = Array.from({ length: 5 }, () => ({}))
    const limited = buildJsonGraph(many, { maxChildren: 2 })
    expect(limited.nodes.map((node) => node.kind)).toEqual(['array', 'object', 'object', 'more'])
    expect(limited.nodes[3].title).toBe('+3 more')
    const capped = buildJsonGraph(many, { maxNodes: 3 })
    expect(capped.nodes).toHaveLength(3)
    expect(capped.truncated).toBe(true)
    expect(buildJsonGraph({ s: 'x'.repeat(200) }, { maxChars: 10 }).nodes[0].rows[0].value).toHaveLength(10)
  })

  it('handles a primitive root and very deep nesting without recursion', () => {
    expect(buildJsonGraph(42).nodes[0]).toMatchObject({ kind: 'value', rows: [{ value: '42', type: 'number' }] })
    let deep: unknown = 1
    for (let index = 0; index < 10_000; index += 1) deep = { d: deep }
    const graph = buildJsonGraph(deep)
    expect(graph.truncated).toBe(true)
    expect(graph.nodes).toHaveLength(1500)
  })
})

describe('layoutJsonGraph', () => {
  it('places children right of their parent, centred on them, without overlap', () => {
    const layout = layoutJsonGraph(buildJsonGraph({ a: { x: 1 }, b: { y: 2 }, c: { z: 3 } }))
    const [root, ...children] = layout.nodes
    for (const child of children) expect(child.x).toBeGreaterThan(root.x + root.width)
    for (let index = 1; index < children.length; index += 1) {
      expect(children[index].y).toBeGreaterThanOrEqual(children[index - 1].y + children[index - 1].height)
    }
    const span = children[children.length - 1].y + children[children.length - 1].height - children[0].y
    expect(root.y + root.height / 2).toBeCloseTo(children[0].y + span / 2)
    expect(layout.edges).toHaveLength(3)
    expect(layout.edges[0].x1).toBe(root.x + root.width)
    expect(layout.width).toBeGreaterThan(0)
  })

  it('shortens rows that would overflow the widest node', () => {
    const layout = layoutJsonGraph(buildJsonGraph({ ['k'.repeat(100)]: 'v'.repeat(80) }))
    const node = layout.nodes[0]
    expect(node.width).toBe(420)
    expect(node.rows[0].key.endsWith('…')).toBe(true)
    expect(node.rows[0].value.endsWith('…')).toBe(true)
    expect(layoutJsonGraph({ nodes: [], edges: [{ from: 'a', to: 'b' }], truncated: false }).edges).toEqual([])
  })
})

describe('jsonGraphViewport', () => {
  it('fits, zooms around a point and culls to the visible area', () => {
    const fit = fitTransform({ width: 1000, height: 500 }, { width: 548, height: 300 })
    expect(fit.k).toBeCloseTo(0.5)
    expect(fitTransform({ width: 0, height: 0 }, { width: 10, height: 10 })).toEqual({ x: 24, y: 24, k: 1 })
    const zoomed = zoomAt({ x: 0, y: 0, k: 1 }, { x: 100, y: 100 }, 2)
    expect(zoomed).toEqual({ x: -100, y: -100, k: 2 })
    expect(zoomAt({ x: 0, y: 0, k: 1 }, { x: 0, y: 0 }, 100).k).toBe(MAX_ZOOM)
    expect(zoomAt({ x: 0, y: 0, k: 1 }, { x: 0, y: 0 }, 0.0001).k).toBe(MIN_ZOOM)
    const view = worldRect({ x: -100, y: 0, k: 2 }, { width: 200, height: 100 })
    expect(view).toEqual({ x: 50, y: -0, width: 100, height: 50 })
    const nodes = [{ id: 'in', x: 60, y: 10, width: 10, height: 10 }, { id: 'out', x: 1000, y: 10, width: 10, height: 10 }]
    expect(cullNodes(nodes, view, 0).map((node) => node.id)).toEqual(['in'])
    expect(cullEdges([{ x1: 0, y1: 0, x2: 60, y2: 20 }, { x1: 900, y1: 0, x2: 950, y2: 0 }], view, 0)).toHaveLength(1)
  })
})

describe('jsonGraphTask', () => {
  it('lays out valid JSON and reuses the parse when only collapse changes', () => {
    const text = JSON.stringify(SAMPLE)
    const first = handleJsonGraphRequest({ text, collapsed: [] }).result
    expect(first.ok && first.layout.nodes).toHaveLength(5)
    const second = handleJsonGraphRequest({ text, collapsed: ['#/tags', 3] }).result
    expect(second.ok && second.layout.nodes).toHaveLength(3)
  })

  it('reports where invalid JSON broke', () => {
    const result = handleJsonGraphRequest({ text: '{\n  "a": 1,\n  oops\n}', collapsed: [] }).result
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.line).toBe(3)
    expect(result.offset).toBe(14)
    expect(() => handleJsonGraphRequest({ text: 1 })).toThrow('Malformed')
  })

  it('locates errors from the text itself, short or long', () => {
    expect(locateJsonError('{"a": }')).toEqual({ offset: 6, line: 1, column: 7 })
    expect(locateJsonError('[1,\n 2,,]')).toEqual({ offset: 7, line: 2, column: 4 })
    expect(locateJsonError('[1, 2]')).toBeNull()
  })
})
