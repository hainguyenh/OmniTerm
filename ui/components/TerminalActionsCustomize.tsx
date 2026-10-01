import { useEffect, useRef } from 'react'
import { Settings2 } from 'lucide-react'
import {
  FOOTER_ACTION_OPTIONS,
  HEADER_ACTION_OPTIONS,
  TERMINAL_ACTION_LABELS,
  type TerminalToolbarAction,
  type TerminalToolbarActions,
} from '../terminalToolbar'

interface TerminalActionsCustomizeProps {
  headerActions: readonly TerminalToolbarAction[]
  footerActions: readonly TerminalToolbarAction[]
  availableHeaderActions: readonly TerminalToolbarAction[]
  availableFooterActions: readonly TerminalToolbarAction[]
  onChange: (actions: TerminalToolbarActions) => void
  onClose: () => void
  placement: 'top' | 'bottom'
}

const menuClass = 'absolute right-0 z-[100] min-w-64 rounded-lg border border-theme-border bg-theme-popup p-3 shadow-2xl'

function toggle(
  current: readonly TerminalToolbarAction[],
  action: TerminalToolbarAction,
  checked: boolean,
): TerminalToolbarAction[] {
  if (checked) return current.includes(action) ? [...current] : [...current, action]
  return current.filter(item => item !== action)
}

function move(items: readonly TerminalToolbarAction[], index: number, direction: -1 | 1): TerminalToolbarAction[] {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= items.length) return [...items]
  return items.map((item, currentIndex) => currentIndex === index
    ? items[nextIndex]
    : currentIndex === nextIndex ? items[index] : item)
}

export default function TerminalActionsCustomize({
  headerActions,
  footerActions,
  availableHeaderActions,
  availableFooterActions,
  onChange,
  onClose,
  placement,
}: TerminalActionsCustomizeProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onMouseDown)
    }
  }, [onClose])

  const renderGroup = (
    title: string,
    options: readonly TerminalToolbarAction[],
    selected: readonly TerminalToolbarAction[],
    available: readonly TerminalToolbarAction[],
    surface: 'header' | 'footer',
  ) => {
    const ordered = [
      ...selected.filter((action) => options.includes(action)),
      ...options.filter((action) => !selected.includes(action)),
    ]
    return (
      <fieldset className="mt-2 first:mt-0">
        <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-theme-dim">{title}</legend>
        <div className="grid gap-1">
          {ordered.map(action => {
            const supported = available.includes(action)
            return (
              <div key={action} className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs ${supported ? 'text-theme-fg hover:bg-theme-bg' : 'text-theme-dim/50'}`}>
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(action)}
                    disabled={!supported}
                    onChange={event => onChange({
                      header: surface === 'header' ? toggle(headerActions, action, event.target.checked) : [...headerActions],
                      footer: surface === 'footer' ? toggle(footerActions, action, event.target.checked) : [...footerActions],
                    })}
                  />
                  <span className="min-w-0 flex-1 truncate">{TERMINAL_ACTION_LABELS[action]}</span>
                </label>
                {selected.includes(action) && (
                  <span className="flex items-center gap-0.5">
                    <button type="button" disabled={selected.indexOf(action) === 0} aria-label={`Move ${TERMINAL_ACTION_LABELS[action]} up`} className="p-0.5 text-theme-dim hover:text-theme-accent disabled:opacity-30" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onChange({ header: surface === 'header' ? move(headerActions, headerActions.indexOf(action), -1) : [...headerActions], footer: surface === 'footer' ? move(footerActions, footerActions.indexOf(action), -1) : [...footerActions] }) }}>
                      ↑
                    </button>
                    <button type="button" disabled={selected.indexOf(action) === selected.length - 1} aria-label={`Move ${TERMINAL_ACTION_LABELS[action]} down`} className="p-0.5 text-theme-dim hover:text-theme-accent disabled:opacity-30" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onChange({ header: surface === 'header' ? move(headerActions, headerActions.indexOf(action), 1) : [...headerActions], footer: surface === 'footer' ? move(footerActions, footerActions.indexOf(action), 1) : [...footerActions] }) }}>
                      ↓
                    </button>
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </fieldset>
    )
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Customize terminal actions"
      className={`${menuClass} ${placement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'}`}
    >
      <div className="flex items-center gap-2 border-b border-theme-border pb-2 text-xs font-semibold text-theme-fg">
        <Settings2 className="h-3.5 w-3.5 text-theme-accent" />
        Customize terminal actions
      </div>
      <p className="mt-2 text-[10px] leading-4 text-theme-dim">Choose which actions stay visible for this terminal. Customize is always available.</p>
      {renderGroup('Header', HEADER_ACTION_OPTIONS, headerActions, availableHeaderActions, 'header')}
      {renderGroup('Footer', FOOTER_ACTION_OPTIONS, footerActions, availableFooterActions, 'footer')}
    </div>
  )
}
