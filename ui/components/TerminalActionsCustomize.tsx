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

const menuClass = 'absolute right-0 z-[100] w-[min(19rem,calc(100vw-1.5rem))] max-h-[min(33rem,calc(100vh-2.5rem))] overflow-y-auto overscroll-contain rounded-lg border border-theme-border bg-theme-popup p-2 shadow-2xl'

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
        <div className="grid min-w-0 gap-0.5">
          {ordered.map(action => {
            const supported = available.includes(action)
            return (
              <div key={action} className={`flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-xs ${supported ? 'text-theme-fg hover:bg-theme-bg' : 'text-theme-dim/50'}`}>
                <span className="min-w-0 flex-1 truncate">{TERMINAL_ACTION_LABELS[action]}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={selected.includes(action)}
                  aria-label={TERMINAL_ACTION_LABELS[action]}
                  data-terminal-toolbar-switch
                  disabled={!supported}
                  onClick={() => onChange({
                    header: surface === 'header' ? toggle(headerActions, action, !selected.includes(action)) : [...headerActions],
                    footer: surface === 'footer' ? toggle(footerActions, action, !selected.includes(action)) : [...footerActions],
                  })}
                  className={`relative h-3.5 w-6 shrink-0 rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-theme-accent disabled:cursor-not-allowed disabled:opacity-40 ${selected.includes(action) ? 'bg-theme-accent' : 'bg-theme-border'}`}
                >
                  <span aria-hidden="true" className={`absolute top-0.5 h-2.5 w-2.5 rounded-sm bg-white shadow-sm transition-all ${selected.includes(action) ? 'left-3' : 'left-0.5'}`} />
                </button>
                {selected.includes(action) && (
                  <span className="flex shrink-0 items-center gap-0.5">
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
      <p className="mt-2 max-w-[34ch] text-[10px] leading-4 text-theme-dim">Switch actions on or off and adjust their order. Unavailable actions cannot be enabled.</p>
      {renderGroup('Header', HEADER_ACTION_OPTIONS, headerActions, availableHeaderActions, 'header')}
      {renderGroup('Footer', FOOTER_ACTION_OPTIONS, footerActions, availableFooterActions, 'footer')}
    </div>
  )
}
