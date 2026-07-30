import React, { useEffect, useRef, useCallback } from 'react'
import { Connection, SessionStatus } from './MainLayout'
import { diag } from '../diag'

interface RDPViewProps {
  id: string
  connection: Connection
  active: boolean
  /** Changes whenever this session's pane slot or the layout mode changes; triggers a
   *  bounds re-push for position-only moves (which fire neither ResizeObserver nor resize). */
  paneEpoch?: string
  overlayActive: boolean
  onStatus?: (status: SessionStatus) => void
  onLatency?: (ms: number | null) => void
}

const RDPView: React.FC<RDPViewProps> = ({ id, active, paneEpoch, overlayActive, onStatus, onLatency }) => {
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep the latest callbacks / active / overlay without making them effect deps.
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const onLatencyRef = useRef(onLatency)
  onLatencyRef.current = onLatency
  const activeRef = useRef(active)
  activeRef.current = active
  const overlayRef = useRef(overlayActive)
  overlayRef.current = overlayActive

  // Send the placeholder's current rect (physical px via dpr) to the main process.
  // Skipped when the element has no size (hidden tab → 0×0 → would collapse mstsc).
  const pushBounds = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    window.omnitermAPI.connect.rdpSetBounds(id, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      dpr: window.devicePixelRatio,
    })
  }, [id])

  // Connection lifecycle
  useEffect(() => {
    let unmounted = false

    onStatusRef.current?.('connecting')

    const cleanupClosed = window.omnitermAPI.connect.onRDPClosed(id, () => {
      if (!unmounted) {
        onStatusRef.current?.('closed')
      }
    })

    const cleanupLatency = window.omnitermAPI.connect.onRDPLatency(id, (ms) => {
      if (!unmounted) {
        onLatencyRef.current?.(ms)
      }
    })

    window.omnitermAPI.connect.rdp(id)
      .then((res) => {
        if (unmounted) return
        if (!res || res.ok === false) {
          // Cancelling the connect prompt closes the session before it connects — show a
          // neutral "closed" status, not a red error. Everything else is a real error.
          const cancelled = res?.error?.includes('closed before')
          onStatusRef.current?.(cancelled ? 'closed' : 'error')
          return
        }
        onStatusRef.current?.('connected')
        // The native mstsc window now exists and is embedded. Re-assert bounds +
        // visibility now that the session exists (the calls fired at mount were dropped
        // because the main-process session did not exist yet). Push a few more times to
        // override mstsc's own resize once the remote desktop finishes loading.
        window.omnitermAPI.connect.rdpSetVisible(id, activeRef.current && !overlayRef.current)
        pushBounds()
        ;[300, 900, 1800].forEach(ms => setTimeout(() => { if (!unmounted) pushBounds() }, ms))
      })
      .catch((err) => {
        if (!unmounted) {
          diag.error('RDP connect error:', err)
          onStatusRef.current?.('error')
        }
      })

    return () => {
      unmounted = true
      cleanupClosed()
      cleanupLatency()
      window.omnitermAPI.connect.rdpDisconnect(id)
    }
  }, [id, pushBounds])

  // Bounds tracking — re-position on layout/window resize.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let rafId = 0
    const schedule = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(pushBounds)
    }

    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    schedule()

    window.addEventListener('resize', schedule)

    return () => {
      ro.disconnect()
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', schedule)
    }
  }, [pushBounds])

  // Visibility tracking — hide on tab switch or when a modal overlay is open.
  useEffect(() => {
    window.omnitermAPI.connect.rdpSetVisible(id, active && !overlayActive)
  }, [id, active, overlayActive])

  // Re-push bounds when the pane assignment or layout mode changes. Moving a session
  // between same-size panes changes position but not size, so neither the ResizeObserver
  // nor the window 'resize' listener fires — this covers that case.
  useEffect(() => {
    const raf = requestAnimationFrame(pushBounds)
    return () => cancelAnimationFrame(raf)
  }, [paneEpoch, pushBounds])

  return (
    <div className="h-full w-full bg-theme-bg">
      {/* Empty placeholder — the native mstsc window is painted on top of this rect. */}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}

export default RDPView
