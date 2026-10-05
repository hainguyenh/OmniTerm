import { readFileSync } from 'node:fs'
import path from 'node:path'

const CSS = readFileSync(path.resolve(process.cwd(), 'ui/components/workspace-file-tree.css'), 'utf8')
  .replace(/\r\n/g, '\n')

/** Declarations of the top-level rule whose selector is exactly `selector`; jsdom loads no CSS. */
export function cssRule(selector: string): string {
  const start = CSS.indexOf(`\n${selector} {\n`)
  if (start < 0) throw new Error(`No rule for ${selector} in workspace-file-tree.css`)
  const open = CSS.indexOf('{', start)
  return CSS.slice(open + 1, CSS.indexOf('}', open)).trim()
}
