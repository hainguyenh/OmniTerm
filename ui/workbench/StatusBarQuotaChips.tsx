import { useLayoutEffect, useRef, useState } from 'react'

import { dockShowsFooter } from '../features/agent-quota/quotaDock'
import { Icon } from '../ide/ui'

import { toggleQuotaPopup, useQuotaDock, useQuotaPopup } from './quota/quotaDockState'
import { QUOTA_ICON } from './quota/quotaIcons'
import { usageColor } from './quota/quotaModel'
import { useFooterProfiles } from './quota/useQuotaGroups'
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
 * How many of the list's items wrapped below its first line. The list wraps instead of clipping, so
 * an item that does not fit disappears whole; this counts them for the "+N" after the list.
 */
function useHiddenCount(list: HTMLElement | null, items: number): number {
  const [hidden, setHidden] = useState(0)
  useLayoutEffect(() => {
    if (!list) return
    const measure = () => {
      const children = Array.from(list.children) as HTMLElement[]
      const top = children[0]?.offsetTop ?? 0
      setHidden(children.filter((child) => child.offsetTop > top).length)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [list, items])
  return hidden
}

/**
 * Agent quota in the footer (Display: footer, or right tool window + footer): the quota icon, then
 * each running profile's name with its used percent above a small bar, separated by `|`. The profile
 * nearest its 5h limit comes first, so a narrow window hides the ones with room to spare. Its left
 * edge is aligned with the editor panel's. Click for details.
 */
export function StatusBarQuotaChips() {
  const dock = useQuotaDock()
  const open = useQuotaPopup((s) => s.open)
  const profiles = useFooterProfiles()
  const ref = useRef<HTMLButtonElement>(null)
  const [list, setList] = useState<HTMLSpanElement | null>(null)
  const editorLeft = useEditorLeft()
  const [offset, setOffset] = useState(0)
  const shown = dockShowsFooter(dock) && profiles.length > 0
  const hidden = useHiddenCount(shown ? list : null, profiles.length)

  useLayoutEffect(() => {
    const button = ref.current
    if (!shown || !button || editorLeft === null) return
    // Where the chips would sit without the offset, then push them to the editor's edge.
    const natural = button.getBoundingClientRect().left - offset
    const next = Math.max(0, Math.round(editorLeft - natural))
    if (next !== offset) setOffset(next)
  }, [shown, editorLeft, offset])

  if (!shown) return null
  const summary = profiles
    .map((row) => `${row.label}: ${row.pct === null ? 'no reading' : `${row.pct}% used`} (${row.detail})`)
    .join('\n')
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
      <span ref={setList} className="omt-q-profiles">
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
      {hidden > 0 && <span className="omt-q-subtle">+{hidden}</span>}
    </button>
  )
}
