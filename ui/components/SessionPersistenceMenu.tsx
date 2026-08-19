import { useEffect, useRef, useState } from 'react'
import { Save, Check } from 'lucide-react'
import {
  getPersistencePolicy,
  setPersistencePolicyOverride,
  type TerminalPersistencePolicy,
} from '../utils/persistencePolicy'
import { Tooltip } from './Tooltip'

interface SessionPersistenceMenuProps {
  sessionId: string
  isAgent: boolean
  placement?: 'top' | 'bottom'
}

const OPTIONS: Array<{ value: TerminalPersistencePolicy; label: string }> = [
  { value: 'close-with-app', label: 'Close with OmniTerm' },
  { value: 'keep-running', label: 'Keep running' },
  { value: 'recover-after-reboot', label: 'Recover after reboot' },
]

/**
 * Per-terminal Hybrid persistence policy control, exposed as a small Save icon button that opens a
 * compact popover menu (mirroring the pane header's "Choose session for this pane" picker on a
 * w-4 h-4 chrome button), so the pane's chrome row stays visually uniform — every affordance is a
 * borderless icon button.
 *
 * Selecting a policy writes a localStorage override and forwards the live update to the session
 * daemon via `connect.setPersistencePolicy`. Reads default to `recover-after-reboot` for AI agents
 * and `keep-running` for ordinary PTY panes (`utils/persistencePolicy`).
 */
export default function SessionPersistenceMenu({
  sessionId,
  isAgent,
  placement = 'bottom',
}: SessionPersistenceMenuProps) {
  const [policy, setPolicy] = useState<TerminalPersistencePolicy>(() =>
    getPersistencePolicy(sessionId, isAgent),
  )
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setPolicy(getPersistencePolicy(sessionId, isAgent))
  }, [isAgent, sessionId])

  // Mirror AppearanceMenu's outside-click / Escape dismissal so the menu never relies on hover
  // away. Both listeners are installed only while the menu is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onClick = (e: MouseEvent) => {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [open])

  const changePolicy = (next: TerminalPersistencePolicy) => {
    setPolicy(next)
    setPersistencePolicyOverride(sessionId, next)
    const update = window.omnitermAPI?.connect?.setPersistencePolicy?.(sessionId, next)
    void update?.catch(() => {})
    setOpen(false)
  }

  const activeLabel = OPTIONS.find((opt) => opt.value === policy)?.label
  const tooltip = activeLabel ? `Session persistence: ${activeLabel}` : 'Session persistence'

  return (
    <div className="relative flex-shrink-0">
      <Tooltip content={tooltip} placement={placement}>
        <button
          ref={btnRef}
          type="button"
          aria-label="Session persistence"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
          className="w-4 h-4 flex items-center justify-center rounded text-theme-dim hover:bg-[#414868] hover:text-theme-accent transition-colors"
        >
          <Save className="w-3 h-3" />
        </button>
      </Tooltip>
      {open && (
        <div
          ref={popRef}
          role="menu"
          aria-label="Session persistence"
          className={`absolute right-0 z-[100] border rounded-lg shadow-2xl py-1 min-w-[190px] ${
            placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
          style={{
            backgroundColor: 'var(--theme-popup-bg)',
            borderColor: 'var(--theme-border)',
            color: 'var(--theme-fg)',
          }}
        >
          <div className="px-3 py-1.5 text-[10px] uppercase font-bold tracking-widest text-theme-dim">
            Persistence
          </div>
          {OPTIONS.map((opt) => {
            const active = policy === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                aria-label={opt.label}
                onClick={() => changePolicy(opt.value)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-white/5 ${
                  active
                    ? 'text-[var(--theme-accent)] font-bold'
                    : 'text-inherit opacity-85 hover:opacity-100'
                }`}
              >
                <span className="flex-1 text-left truncate">{opt.label}</span>
                {active && <Check className="w-3 h-3 flex-shrink-0 text-[var(--theme-accent)]" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
