import { useLayoutEffect, useRef, useState } from 'react'

import { dockShowsFooter } from '../features/agent-quota/quotaDock'
import { Icon } from '../ide/ui'

import { toggleQuotaPopup, useQuotaDock, useQuotaPopup } from './quota/quotaDockState'
import { QUOTA_ICON } from './quota/quotaIcons'
import { usageColor, type QuotaFooterAgent } from './quota/quotaModel'
import { useFooterQuota } from './quota/useQuotaGroups'
import './quota/quotaWorkbench.css'

/** The editor panel's left edge, in window coordinates; follows tool window resizes. */
function useEditorLeft(): number | null {
  const [left, setLeft] = useState<number | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const editor = document.querySelector('[data-editor-area]')
      setLeft(editor ? Math.round(editor.getBoundingClientRect().left) : null)
    }
    measure()
    const observer = new ResizeObserver(measure)
    // The editor moves when a left tool window opens or resizes; observing the body catches both.
    observer.observe(document.body)
    const editor = document.querySelector('[data-editor-area]')
    if (editor) observer.observe(editor)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  return left
}

/**
 * Agent quota in the footer (Display: footer, or right tool window + footer): the quota icon, then
 * each running profile's name with its used percent above a tiny bar: the compact twin of the pane
 * strip (which Settings can hide). Agent names and active-profile counts are in the tooltip. Its left edge is aligned with the
 * editor panel's. Click for details.
 */
export function StatusBarQuotaChips() {
  const dock = useQuotaDock()
  const open = useQuotaPopup((s) => s.open)
  const { profiles, agents } = useFooterQuota()
  const ref = useRef<HTMLButtonElement>(null)
  const editorLeft = useEditorLeft()
  const [offset, setOffset] = useState(0)
  const shown = dockShowsFooter(dock) && profiles.length > 0

  useLayoutEffect(() => {
    const button = ref.current
    if (!shown || !button || editorLeft === null) return
    // Where the chips would sit without the offset, then push them to the editor's edge.
    const natural = button.getBoundingClientRect().left - offset
    const next = Math.max(0, Math.round(editorLeft - natural))
    if (next !== offset) setOffset(next)
  }, [shown, editorLeft, offset])

  if (!shown) return null
  const label = (row: QuotaFooterAgent) => `${row.activeProfiles} active ${row.activeProfiles === 1 ? 'profile' : 'profiles'}`
  const summary = agents.map((row) => `${row.name}: ${label(row)}`).join('\n')
  return (
    <button
      ref={ref}
      type="button"
      className="omt-q-footer"
      style={{ marginLeft: offset }}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={`Agent quota, click for all profiles\n${summary}`}
      onClick={toggleQuotaPopup}
      data-testid="status-bar-quota-chips"
    >
      <Icon name={QUOTA_ICON} size={16} />
      <span className="omt-q-profiles">
        {profiles.map((row) => (
          <span key={row.key} className="omt-q-prof" data-active={row.active || undefined} data-testid="quota-footer-profile">
            <span className="omt-q-prof-name">{row.label}</span>
            <span className="omt-q-meter">
              <span className="omt-q-meter-pct">{row.pct === null ? '–' : `${row.pct}%`}</span>
              <span className="omt-q-mini">
                <i style={{ width: `${row.pct ?? 0}%`, background: usageColor(row.pct) }} />
              </span>
            </span>
          </span>
        ))}
      </span>
    </button>
  )
}
