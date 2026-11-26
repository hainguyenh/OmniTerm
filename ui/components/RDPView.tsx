import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Connection, SessionStatus } from './MainLayout'
import { diag } from '../diag'

import { rdpPlaceholderText, type RdpPhase } from './rdpPlaceholder'

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

const RDPView: React.FC<RDPViewProps> = ({ id, connection, active, paneEpoch, overlayActive, onStatus, onLatency }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<RdpPhase>('starting')

  // Keep the latest callbacks / active / overlay without making them effect deps.
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const onLatencyRef = useRef(onLatency)
  onLatencyRef.current = onLatency
  const activeRef = useRef(active)
  activeRef.current = active
  const overlayRef = useRef(overlayActive)
  overlayRef.current = overlayActive

  // The placeholder's current rect in CSS px plus the dpr the host converts it with. `null` when
  // the element has no size (hidden tab → 0×0 → would collapse mstsc).
  const measure = useCallback(() => {
    const el = containerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, dpr: window.devicePixelRatio }
  }, [])

  // Send the pane's rect to the host, which keeps the docked client window on it.
  const pushBounds = useCallback(() => {
    const bounds = measure()
    if (bounds) window.omnitermAPI.connect.rdpSetBounds(id, bounds)
  }, [id, measure])

  // Connection lifecycle
  useEffect(() => {
    let unmounted = false

    onStatusRef.current?.('connecting')

    const cleanupClosed = window.omnitermAPI.connect.onRDPClosed(id, () => {
      if (!unmounted) {
        setPhase('closed')
        onStatusRef.current?.('closed')
      }
    })

    const cleanupDocked = window.omnitermAPI.connect.onRDPDocked(id, () => {
      if (!unmounted) setPhase('docked')
    })

    const cleanupLatency = window.omnitermAPI.connect.onRDPLatency(id, (ms) => {
      if (!unmounted) {
        onLatencyRef.current?.(ms)
      }
    })

    // The first size goes with the launch so the client opens as a window of the pane's size —
    // a full-screen client cannot be docked.
    window.omnitermAPI.connect.rdp(id, measure() ?? undefined)
      .then((res) => {
        if (unmounted) return
        if (!res || res.ok === false) {
          // Cancelling the connect prompt closes the session before it connects — show a
          // neutral "closed" status, not a red error. Everything else is a real error.
          const cancelled = res?.error?.includes('closed before')
          setPhase(cancelled ? 'closed' : 'error')
          onStatusRef.current?.(cancelled ? 'closed' : 'error')
          return
        }
        setPhase((current) => (current === 'starting' ? 'signing-in' : current))
        onStatusRef.current?.('connected')
        // Re-assert bounds + visibility now that the client is running, and a few more times to
        // override the client's own resize once the remote desktop finishes loading.
        window.omnitermAPI.connect.rdpSetVisible(id, activeRef.current && !overlayRef.current)
        pushBounds()
        ;[300, 900, 1800].forEach(ms => setTimeout(() => { if (!unmounted) pushBounds() }, ms))
      })
      .catch((err) => {
        if (!unmounted) {
          diag.error('RDP connect error:', err)
          setPhase('error')
          onStatusRef.current?.('error')
        }
      })

    return () => {
      unmounted = true
      cleanupClosed()
      cleanupDocked()
      cleanupLatency()
      window.omnitermAPI.connect.rdpDisconnect(id)
    }
  }, [id, measure, pushBounds])

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

  const message = rdpPlaceholderText(phase, connection.host || connection.name)

  return (
    <div className="h-full w-full bg-theme-bg">
      {/* The native client window is docked over this rect once the session connects. */}
      <div ref={containerRef} className="flex h-full w-full items-center justify-center p-6">
        {message && <p className="max-w-md text-center text-sm text-theme-dim">{message}</p>}
      </div>
    </div>
  )
}

export default RDPView
