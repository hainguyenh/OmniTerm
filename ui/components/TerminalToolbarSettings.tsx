import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'

import {
  FOOTER_ACTION_OPTIONS,
  HEADER_ACTION_OPTIONS,
  TERMINAL_ACTION_LABELS,
  toolbarActionsFor,
  type TerminalToolbarAction,
  type TerminalToolbarActions,
} from '../terminalToolbar'

interface TerminalToolbarSettingsProps {
  value?: TerminalToolbarActions
  onChange: (value: TerminalToolbarActions) => void
}

const move = (items: readonly TerminalToolbarAction[], index: number, direction: -1 | 1) => {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= items.length) return [...items]
  const next = [...items]
  const current = next[index]
  next[index] = next[nextIndex]
  next[nextIndex] = current
  return next
}

export default function TerminalToolbarSettings({ value, onChange }: TerminalToolbarSettingsProps) {
  const header = toolbarActionsFor(value, 'header')
  const footer = toolbarActionsFor(value, 'footer')
  const update = (surface: 'header' | 'footer', actions: readonly TerminalToolbarAction[]) => onChange({
    header: surface === 'header' ? [...actions] : header,
    footer: surface === 'footer' ? [...actions] : footer,
  })

  const group = (surface: 'header' | 'footer', title: string, options: readonly TerminalToolbarAction[], selected: readonly TerminalToolbarAction[]) => {
    const ordered = [
      ...selected.filter((action) => options.includes(action)),
      ...options.filter((action) => !selected.includes(action)),
    ]
    return (
      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="text-[10px] font-semibold uppercase tracking-widest text-theme-dim">{title}</legend>
        {ordered.map((action) => {
          const index = selected.indexOf(action)
          const checked = index !== -1
          return (
            <div key={action} className="flex min-w-0 items-center gap-1.5 rounded-lg border border-theme-border px-2 py-1 text-xs">
              <GripVertical className="h-3 w-3 shrink-0 text-theme-dim" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{TERMINAL_ACTION_LABELS[action]}</span>
              <button
                type="button"
                role="switch"
                aria-label={TERMINAL_ACTION_LABELS[action]}
                aria-checked={checked}
                data-terminal-toolbar-switch
                onClick={() => update(surface, checked
                  ? selected.filter(item => item !== action)
                  : [...selected, action])}
                className={`relative h-3.5 w-6 shrink-0 rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-theme-accent ${checked ? 'bg-theme-accent' : 'bg-theme-border'}`}
              >
                <span aria-hidden="true" className={`absolute top-0.5 h-2.5 w-2.5 rounded-sm bg-white shadow-sm transition-all ${checked ? 'left-3' : 'left-0.5'}`} />
              </button>
              <button type="button" disabled={!checked || index === 0} aria-label={`Move ${TERMINAL_ACTION_LABELS[action]} up`} className="p-0.5 text-theme-dim hover:text-theme-accent disabled:opacity-30" onClick={() => update(surface, move(selected, index, -1))}>
                <ArrowUp className="h-3 w-3" />
              </button>
              <button type="button" disabled={!checked || index === selected.length - 1} aria-label={`Move ${TERMINAL_ACTION_LABELS[action]} down`} className="p-0.5 text-theme-dim hover:text-theme-accent disabled:opacity-30" onClick={() => update(surface, move(selected, index, 1))}>
                <ArrowDown className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </fieldset>
    )
  }

  return (
    <section className="flex flex-col gap-2 border-t border-theme-border pt-3" aria-label="Global terminal toolbar">
      <div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-theme-fg">Terminal header &amp; footer</span>
        <p className="mt-1 w-full max-w-none text-[11px] leading-relaxed text-theme-dim">Choose the default actions and their order for every terminal. A terminal-level customization can still override this.</p>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-2">
        {group('header', 'Header', HEADER_ACTION_OPTIONS, header)}
        {group('footer', 'Footer', FOOTER_ACTION_OPTIONS, footer)}
      </div>
    </section>
  )
}
