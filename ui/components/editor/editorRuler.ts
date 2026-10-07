import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'

/**
 * Renders vertical column guides (rulers) in the editor corresponding to ESLint
 * `max-len` column conventions (standard 80 columns, and secondary 100 columns).
 */
export function eslintRuler(columns: number[] = [80, 100]): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      private rulers: HTMLElement[] = []

      constructor(view: EditorView) {
        this.rulers = columns.map((col) => {
          const el = document.createElement('div')
          el.className = `cm-eslint-ruler cm-eslint-ruler-${col}`
          el.setAttribute('aria-hidden', 'true')
          el.style.left = `calc(10px + ${col}ch)`
          view.scrollDOM.appendChild(el)
          return el
        })
      }

      destroy() {
        for (const ruler of this.rulers) {
          ruler.remove()
        }
      }
    },
  )

  const theme = EditorView.theme({
    '.cm-scroller': {
      position: 'relative',
    },
    '.cm-eslint-ruler': {
      position: 'absolute',
      top: '0',
      bottom: '0',
      width: '1px',
      pointerEvents: 'none',
      borderLeft: '1px dashed color-mix(in srgb, var(--theme-border) 45%, transparent)',
      zIndex: '-1',
    },
    '.cm-eslint-ruler-80': {
      borderLeftColor: 'color-mix(in srgb, var(--theme-border) 55%, transparent)',
    },
    '.cm-eslint-ruler-100': {
      borderLeftColor: 'color-mix(in srgb, var(--theme-border) 35%, transparent)',
    },
  })

  return [plugin, theme]
}
