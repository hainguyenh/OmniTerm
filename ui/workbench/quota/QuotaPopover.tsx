import { useEffect, type CSSProperties } from 'react'

import { dockShowsFooter, dockStripSide, type QuotaDock } from '../../features/agent-quota/quotaDock'
import { quotaCommands } from '../../features/agent-quota/quotaStore'

import { closeQuotaPopup, useQuotaDock, useQuotaPopup } from './quotaDockState'
import { QuotaBody, QuotaDockButtons } from './QuotaPanel'
import './quotaWorkbench.css'

/** Next to the strip line it opened from, or above the footer chips at the editor's left edge. */
function placement(dock: QuotaDock): CSSProperties | null {
  const strip = dockStripSide(dock)
  if (strip === 'left') return { left: 44, top: 120 }
  if (strip === 'right') return { right: 44, top: 120 }
  if (!dockShowsFooter(dock)) return null
  const editor = document.querySelector('[data-editor-area]')
  return { left: editor ? Math.round(editor.getBoundingClientRect().left) : 44, bottom: 30 }
}

/**
 * The quota details popup of the tab strip line and the footer chips: the quota panel, then
 * "Move to" dock buttons and a link to the plugin's settings. Escape or a click outside closes it.
 */
export function QuotaPopover() {
  const open = useQuotaPopup((s) => s.open)
  const dock = useQuotaDock()
  const style = open ? placement(dock) : null

  useEffect(() => {
    if (!style) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeQuotaPopup()
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      // The opener toggles the popup itself.
      if (target?.closest('[data-quota-popover], .omt-q-stripe, .omt-q-footer')) return
      closeQuotaPopup()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer, true)
    }
  }, [style])

  if (!style) return null
  return (
    <div className="omt-q-pop" style={style} role="dialog" aria-label="Agent quota" data-quota-popover="">
      <QuotaBody />
      <div className="omt-q-pop-sep" />
      <div className="omt-q-pop-foot">
        <span className="omt-q-muted">Move to:</span>
        <QuotaDockButtons />
        <button
          type="button"
          className="omt-q-link"
          onClick={() => {
            closeQuotaPopup()
            quotaCommands().openSettings()
          }}
        >
          Settings
        </button>
      </div>
    </div>
  )
}
