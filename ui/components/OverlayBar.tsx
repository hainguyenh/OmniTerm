import React, { useEffect, useState } from 'react'
import { Minimize2, Unplug, Monitor } from 'lucide-react'

/**
 * Floating restore bar shown over a fullscreen (detached) RDP session
 * Rendered into a small always-on-top, transparent overlay window (see main.ts) that
 * sits at the top-center of the same monitor as the fullscreen remote desktop. It is the
 * primary, always-visible way to leave fullscreen, since the detached mstsc window covers
 * the app's own footer button.
 */
const OverlayBar: React.FC = () => {
  const [id, setId] = useState<string | null>(null)
  const [name, setName] = useState('Remote session')

  useEffect(() => {
    let cancelled = false
    window.omnitermAPI.connect.overlayInit().then(info => {
      if (cancelled || !info) return
      setId(info.id)
      setName(info.name)
    })
    return () => { cancelled = true }
  }, [])

  const restore = () => {
    if (id) window.omnitermAPI.connect.rdpSetDetached(id, false)
  }
  const disconnect = () => {
    if (id) window.omnitermAPI.connect.rdpDisconnect(id)
  }

  return (
    // The window is transparent; this group hugs the top edge and slides fully into view
    // on hover so it stays out of the way until the user reaches for it.
    <div className="group h-screen w-screen flex items-start justify-center bg-transparent overflow-hidden select-none">
      <div className="-translate-y-2 group-hover:translate-y-0 transition-transform duration-150 flex items-center gap-3 px-3 h-10 rounded-b-xl bg-theme-sidebar/95 border border-t-0 border-theme-border shadow-lg shadow-black/40">
        <Monitor className="w-4 h-4 text-theme-accent flex-shrink-0" />
        <span className="text-sm font-medium text-white truncate max-w-[220px]">{name}</span>

        <button
          onClick={restore}
          title="Restore into tab (exit fullscreen)"
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border border-theme-border text-theme-fg hover:border-theme-accent hover:text-theme-accent transition-colors"
        >
          <Minimize2 className="w-3.5 h-3.5" />
          Restore
        </button>

        <button
          onClick={disconnect}
          title="Disconnect"
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border border-theme-border text-theme-error hover:border-[#f7768e] hover:bg-theme-error/10 transition-colors"
        >
          <Unplug className="w-3.5 h-3.5" />
          Disconnect
        </button>
      </div>
    </div>
  )
}

export default OverlayBar
