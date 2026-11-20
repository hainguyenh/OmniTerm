import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const DIR = path.resolve(process.cwd(), 'ui/components/editor/preview')
const read = (file: string) => readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n')
const PREVIEWS = ['JsonGraphCanvas.tsx', 'CsvPreview.tsx', 'HtmlPreview.tsx', 'PreviewMessage.tsx']
const PREFIXES = /\b(?:json-graph|csv|file-editor)(?:-[a-z]+)*\b/g

/** Class names the previews style from preview.css, collected from their string literals. */
function usedClasses(source: string): string[] {
  const literals = source.match(/(["'`])(?:(?!\1).)*\1/g) ?? []
  return [...new Set(literals.flatMap((literal) => literal.match(PREFIXES) ?? []))]
}

// jsdom loads no CSS, so a deleted stylesheet goes unnoticed in component tests: the JSON graph
// then renders its SVG nodes with the default black fill.
describe('preview styles', () => {
  const css = read('preview.css')

  it.each(PREVIEWS)('%s imports preview.css', (file) => {
    expect(read(file)).toContain("import './preview.css'")
  })

  it.each(PREVIEWS)('every class %s uses has a rule in preview.css', (file) => {
    const classes = usedClasses(read(file))
    expect(classes.length).toBeGreaterThan(0)
    for (const name of classes) {
      expect(css, name).toMatch(new RegExp(`\\.${name}[\\s.,:{]`))
    }
  })

  it('gives JSON graph nodes a theme fill instead of the SVG default black', () => {
    expect(css).toMatch(/\.json-graph-node \{[^}]*fill: var\(--theme-[a-z-]+\)/)
    expect(css).toMatch(/\.json-graph \{[^}]*background-color: var\(--theme-bg\)/)
  })
})
