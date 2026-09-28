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

  const group = (surface: 'header' | 'footer', title: string, options: readonly TerminalToolbarAction[], selected: readonly TerminalToolbarAction[]) => (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-[10px] font-semibold uppercase tracking-widest text-theme-dim">{title}</legend>
      {options.map((action) => {
        const index = selected.indexOf(action)
        const checked = index !== -1
        return (
          <div key={action} className="flex items-center gap-1.5 rounded-lg border border-theme-border px-2 py-1 text-xs">
            <GripVertical className="h-3 w-3 text-theme-dim" aria-hidden="true" />
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => update(surface, event.target.checked
                  ? [...selected, action]
                  : selected.filter((item) => item !== action))}
              />
              <span className="truncate">{TERMINAL_ACTION_LABELS[action]}</span>
            </label>
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

  return (
    <section className="flex flex-col gap-2 border-t border-theme-border pt-3" aria-label="Global terminal toolbar">
      <div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-theme-fg">Terminal header &amp; footer</span>
        <p className="mt-1 text-[11px] leading-relaxed text-theme-dim">Choose the default actions and their order for every terminal. A terminal-level customization can still override this.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {group('header', 'Header', HEADER_ACTION_OPTIONS, header)}
        {group('footer', 'Footer', FOOTER_ACTION_OPTIONS, footer)}
      </div>
    </section>
  )
}
