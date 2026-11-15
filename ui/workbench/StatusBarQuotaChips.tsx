import { Fragment, useLayoutEffect, useRef, useState } from 'react'

import { dockShowsFooter } from '../../plugins/agent-quota/app/quotaDock'
import { Icon } from '../ide/ui'

import { toggleQuotaPopup, useQuotaDock, useQuotaPopup } from './quota/quotaDockState'
import { QUOTA_ICON } from './quota/quotaIcons'
import { usageColor } from './quota/quotaModel'
import { useQuotaGroups } from './quota/useQuotaGroups'
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
 * Agent quota in the footer (Display: footer, or right tool window + footer): a chip per agent for
 * the active session's profile, its left edge aligned with the editor panel's. Click for details.
 */
export function StatusBarQuotaChips() {
  const dock = useQuotaDock()
  const open = useQuotaPopup((s) => s.open)
  const { groups } = useQuotaGroups()
  const ref = useRef<HTMLButtonElement>(null)
  const editorLeft = useEditorLeft()
  const [offset, setOffset] = useState(0)
  const shown = dockShowsFooter(dock) && groups.length > 0

  useLayoutEffect(() => {
    const button = ref.current
    if (!shown || !button || editorLeft === null) return
    // Where the chips would sit without the offset, then push them to the editor's edge.
    const natural = button.getBoundingClientRect().left - offset
    const next = Math.max(0, Math.round(editorLeft - natural))
    if (next !== offset) setOffset(next)
  }, [shown, editorLeft, offset])

  if (!shown) return null
  return (
    <button
      ref={ref}
      type="button"
      className="omt-q-footer"
      style={{ marginLeft: offset }}
      aria-haspopup="dialog"
      aria-expanded={open}
      title="Agent quota: click for all profiles"
      onClick={toggleQuotaPopup}
      data-testid="status-bar-quota-chips"
    >
      <Icon name={QUOTA_ICON} size={16} />
      {groups.map((group, index) => {
        const { pct, name } = group.shown
        return (
          <Fragment key={group.agent}>
            {index > 0 && <span className="omt-q-subtle">·</span>}
            <span className="omt-q-chip">
              {group.name}
              {group.active && group.profiles.length > 1 && <span className="omt-q-subtle">({name})</span>}
              <span className="omt-q-mini">
                <i style={{ width: `${pct ?? 0}%`, background: usageColor(pct) }} />
              </span>
              {pct === null ? '–' : `${pct}%`}
            </span>
          </Fragment>
        )
      })}
    </button>
  )
}
